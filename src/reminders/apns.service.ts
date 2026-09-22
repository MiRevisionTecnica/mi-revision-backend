import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { connect, constants, type ClientHttp2Session } from 'node:http2';
import { createPrivateKey, createSign } from 'node:crypto';

/**
 * Envío de notificaciones a iPhone, directo a Apple.
 *
 * **Por qué directo y no por Firebase.** Firebase entrega a Apple igual que
 * nosotros, pero para que él lo haga la app tendría que pedirle a Firebase un
 * token propio, y eso obliga a meter el SDK nativo de Firebase en la app de
 * iOS. Lo que iOS entrega por su cuenta --y lo que la app ya guarda-- es el
 * token de APNs, que es justo lo que Apple espera acá. Un intermediario menos
 * y ningún módulo nativo nuevo.
 *
 * La credencial es una clave de APNs (.p8) creada en la cuenta de desarrollador.
 * No caduca y sirve para todas las apps del equipo, a diferencia de los
 * certificados antiguos, que vencían cada año.
 *
 * Sin clave configurada esto no rompe nada: informa que no está disponible y
 * los avisos siguen saliendo para Android y por correo.
 */

const HOST_PRODUCCION = 'api.push.apple.com';
const HOST_PRUEBAS = 'api.sandbox.push.apple.com';

/** El token de autorización vale una hora; se renueva antes por seguridad. */
const VIDA_DEL_TOKEN_MS = 45 * 60 * 1000;

const TIMEOUT_MS = 10_000;

export type MensajeApns = {
  token: string;
  title: string;
  body: string;
  data?: Record<string, string>;
};

export type ResultadoApns = {
  entregados: number;
  /** Tokens que Apple ya no reconoce: hay que borrarlos. */
  muertos: string[];
};

@Injectable()
export class ApnsService {
  private readonly logger = new Logger(ApnsService.name);
  private autorizacion: { valor: string; at: number } | null = null;

  constructor(private readonly config: ConfigService) {}

  /** Si hay credenciales para hablar con Apple. */
  get disponible(): boolean {
    return Boolean(this.clave && this.keyId && this.teamId);
  }

  private get clave(): string | undefined {
    const bruta = this.config.get<string>('APNS_KEY');
    if (!bruta) return undefined;

    // En Railway la clave viaja en base64, porque un .p8 tiene saltos de línea
    // y las variables de entorno los pierden.
    return bruta.includes('BEGIN PRIVATE KEY')
      ? bruta.replace(/\\n/g, '\n')
      : Buffer.from(bruta, 'base64').toString('utf8');
  }

  private get keyId(): string | undefined {
    return this.config.get<string>('APNS_KEY_ID');
  }

  private get teamId(): string | undefined {
    return this.config.get<string>('APNS_TEAM_ID');
  }

  private get bundleId(): string {
    return this.config.get<string>('APNS_BUNDLE_ID', 'cl.mirevisiontecnica.app');
  }

  /**
   * El servidor al que se entrega.
   *
   * Las apps de TestFlight y de la App Store usan el de producción; solo una
   * compilada para desarrollo usa el de pruebas, y sus tokens no valen en el
   * otro. Por eso es una variable y no una deducción.
   */
  private get host(): string {
    return this.config.get<string>('APNS_ENTORNO') === 'pruebas' ? HOST_PRUEBAS : HOST_PRODUCCION;
  }

  async send(mensajes: MensajeApns[]): Promise<ResultadoApns> {
    if (mensajes.length === 0) return { entregados: 0, muertos: [] };

    if (!this.disponible) {
      this.logger.warn(
        `${mensajes.length} aviso(s) para iPhone sin enviar: falta la clave de APNs ` +
          '(APNS_KEY, APNS_KEY_ID y APNS_TEAM_ID).',
      );
      return { entregados: 0, muertos: [] };
    }

    const autorizacion = this.autorizacionVigente();
    if (!autorizacion) return { entregados: 0, muertos: [] };

    const sesion = connect(`https://${this.host}`);
    sesion.setTimeout(TIMEOUT_MS, () => sesion.destroy(new Error('Apple no respondió a tiempo')));

    const resultado: ResultadoApns = { entregados: 0, muertos: [] };

    try {
      // Una sola conexión para todos: HTTP/2 multiplexa, que es justamente para
      // lo que Apple pide HTTP/2.
      for (const mensaje of mensajes) {
        const respuesta = await this.entregar(sesion, autorizacion, mensaje);

        if (respuesta.estado === 200) {
          resultado.entregados++;
          continue;
        }

        // 410 es "este token ya no existe"; 400 con BadDeviceToken, lo mismo.
        if (respuesta.estado === 410 || respuesta.razon === 'BadDeviceToken') {
          resultado.muertos.push(mensaje.token);
          continue;
        }

        this.logger.warn(`Apple rechazó un aviso (${respuesta.estado}): ${respuesta.razon}`);
      }
    } catch (error) {
      this.logger.error(
        `No se pudo entregar a Apple: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      sesion.close();
    }

    return resultado;
  }

  private entregar(
    sesion: ClientHttp2Session,
    autorizacion: string,
    mensaje: MensajeApns,
  ): Promise<{ estado: number; razon: string }> {
    const cuerpo = JSON.stringify({
      aps: {
        alert: { title: mensaje.title, body: mensaje.body },
        sound: 'default',
        badge: 1,
      },
      ...mensaje.data,
    });

    return new Promise((cumplir) => {
      const peticion = sesion.request({
        [constants.HTTP2_HEADER_METHOD]: 'POST',
        [constants.HTTP2_HEADER_PATH]: `/3/device/${mensaje.token}`,
        [constants.HTTP2_HEADER_AUTHORIZATION]: `bearer ${autorizacion}`,
        'apns-topic': this.bundleId,
        'apns-push-type': 'alert',
        // Un vencimiento no sirve de nada si llega tarde, pero tampoco hay que
        // despertar el teléfono: 5 es "normal", que es lo correcto para un aviso
        // que la persona puede leer cuando lo mire.
        'apns-priority': '5',
        // Si el teléfono estuvo apagado una semana, el aviso ya no tiene sentido.
        'apns-expiration': String(Math.floor(Date.now() / 1000) + 24 * 60 * 60),
        [constants.HTTP2_HEADER_CONTENT_TYPE]: 'application/json',
        [constants.HTTP2_HEADER_CONTENT_LENGTH]: Buffer.byteLength(cuerpo),
      });

      let estado = 0;
      let texto = '';

      peticion.on('response', (cabeceras) => {
        estado = Number(cabeceras[constants.HTTP2_HEADER_STATUS] ?? 0);
      });

      peticion.on('data', (trozo: Buffer) => {
        texto += trozo.toString();
      });

      peticion.on('end', () => {
        let razon = texto;
        try {
          razon = (JSON.parse(texto) as { reason?: string }).reason ?? texto;
        } catch {
          // Apple responde vacío cuando todo salió bien.
        }
        cumplir({ estado, razon });
      });

      peticion.on('error', (error) => cumplir({ estado: 0, razon: error.message }));

      peticion.end(cuerpo);
    });
  }

  /**
   * El token con el que Apple nos reconoce.
   *
   * Es un JWT firmado con la clave .p8. Apple rechaza los que se renuevan
   * demasiado seguido, así que se reutiliza mientras esté fresco.
   */
  private autorizacionVigente(): string | null {
    if (this.autorizacion && Date.now() - this.autorizacion.at < VIDA_DEL_TOKEN_MS) {
      return this.autorizacion.valor;
    }

    try {
      const valor = firmarJwt(this.clave!, this.keyId!, this.teamId!);
      this.autorizacion = { valor, at: Date.now() };
      return valor;
    } catch (error) {
      this.logger.error(
        `La clave de APNs no sirve: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }
}

function base64Url(valor: Buffer | string): string {
  return Buffer.from(valor)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * El JWT que pide Apple: ES256, con el identificador de la clave en la cabecera
 * y el del equipo en el contenido.
 *
 * Se firma con `node:crypto` y no con una biblioteca: son veinte líneas, y la
 * única parte delicada --que la firma vaya en formato plano de 64 bytes y no en
 * DER-- la resuelve `dsaEncoding`.
 */
function firmarJwt(clave: string, keyId: string, teamId: string): string {
  const cabecera = base64Url(JSON.stringify({ alg: 'ES256', kid: keyId }));
  const contenido = base64Url(
    JSON.stringify({ iss: teamId, iat: Math.floor(Date.now() / 1000) }),
  );

  const firma = createSign('SHA256')
    .update(`${cabecera}.${contenido}`)
    .sign({ key: createPrivateKey(clave), dsaEncoding: 'ieee-p1363' });

  return `${cabecera}.${contenido}.${base64Url(firma)}`;
}
