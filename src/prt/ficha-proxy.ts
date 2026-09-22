import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { request as pedirHttps } from 'node:https';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rootCertificates } from 'node:tls';

/**
 * Sirve la ficha del vehículo del Ministerio a través de nuestro servidor.
 *
 * **Por qué.** `www.prt.cl` entrega su certificado sin el intermedio (Let's
 * Encrypt YR2) ni el puente que lo conecta con una raíz conocida (ISRG Root YR,
 * de 2025, que casi ningún teléfono trae todavía). Un navegador de escritorio
 * disimula esa falla descargando lo que falta al vuelo; el navegador incrustado
 * de Android no lo hace, y la consulta muere con "la autoridad certificadora no
 * es de confianza". No es un problema nuestro ni de la app: es su servidor mal
 * configurado, pero quien no puede buscar su patente es nuestro usuario.
 *
 * Acá se completa la cadena con los certificados que el servidor omite --los
 * mismos que ya usábamos para las cámaras-- **sin desactivar ninguna
 * verificación**: la cadena sigue cerrando contra una raíz de confianza, y si
 * alguien se interpusiera, la petición fallaría igual.
 *
 * **Lo que NO hace.** No toca el captcha. La casilla "No soy un robot" la sigue
 * marcando la persona, en su teléfono, y el token que genera viaja tal cual al
 * Ministerio. Acá solo se transporta lo que la persona pidió: una consulta por
 * cada búsqueda, con nuestro nombre en el `user-agent`.
 */

const BASE = 'https://www.prt.cl/Paginas/';
const RUTA = '/Paginas/QRRevisionTecnica.aspx';
const HOST = 'www.prt.cl';

const TIMEOUT_MS = 15_000;

/** Tope de la página, para que una respuesta rara no llene la memoria. */
const MAX_BYTES = 2 * 1024 * 1024;

/**
 * Cuánto vive una consulta a medias.
 *
 * Es el tiempo entre que se abre la página y se marca la casilla. Más que eso
 * y el token del captcha ya habría expirado igual.
 */
const SESION_MS = 5 * 60 * 1000;

/** Tope de consultas abiertas a la vez, para no acumular memoria. */
const MAX_SESIONES = 500;

type Sesion = { cookies: string[]; patente: string; at: number };

export type Ficha = {
  /** El identificador para enviar el formulario de esta misma consulta. */
  sesion: string;
  /** La página, lista para mostrarse en la app. */
  html: string;
};

@Injectable()
export class FichaProxy {
  private readonly logger = new Logger(FichaProxy.name);
  private readonly sesiones = new Map<string, Sesion>();
  private extras: string | null = null;

  /** Abre la consulta de una patente y devuelve la página con el captcha. */
  async abrir(patente: string): Promise<Ficha> {
    const limpia = patente.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    const { cuerpo, cookies } = await this.pedir('GET', `${RUTA}?patente=${limpia}`, null, []);

    this.limpiarViejas();
    const sesion = randomUUID();
    this.sesiones.set(sesion, { cookies, patente: limpia, at: Date.now() });

    return { sesion, html: prepararParaLaApp(cuerpo) };
  }

  /**
   * Envía el formulario que la persona ya resolvió y devuelve la respuesta.
   *
   * Los campos van tal como los armó la página --incluido el token del captcha
   * y el `__VIEWSTATE`, que es lo que ata la respuesta a esta misma consulta--.
   */
  async enviar(sesion: string, campos: Record<string, string>): Promise<string> {
    const guardada = this.sesiones.get(sesion);
    if (!guardada || Date.now() - guardada.at > SESION_MS) {
      this.sesiones.delete(sesion);
      throw new ServiceUnavailableException('La consulta expiró. Búscala de nuevo.');
    }

    // La patente viaja en la dirección, no en el formulario: es de ahí de donde
    // la lee su servidor. Sin ella la respuesta llega sin ningún dato --que era
    // justo lo que pasaba: volvía solo la patente que la persona había escrito--.
    const cuerpo = new URLSearchParams(campos).toString();
    const respuesta = await this.pedir(
      'POST',
      `${RUTA}?patente=${guardada.patente}`,
      cuerpo,
      guardada.cookies,
    );

    this.sesiones.delete(sesion);
    return prepararParaLaApp(respuesta.cuerpo);
  }

  private async cadenasFaltantes(): Promise<string> {
    if (this.extras === null) {
      const aqui = dirname(fileURLToPath(import.meta.url));
      this.extras = await readFile(
        resolve(aqui, '../plants/certs/cadenas-faltantes.pem'),
        'utf8',
      );
    }
    return this.extras;
  }

  private limpiarViejas(): void {
    const ahora = Date.now();
    for (const [id, sesion] of this.sesiones) {
      if (ahora - sesion.at > SESION_MS) this.sesiones.delete(id);
    }
    // Si aún hay demasiadas, se sueltan las más antiguas: el Map conserva el
    // orden de inserción, así que las primeras son las más viejas.
    while (this.sesiones.size > MAX_SESIONES) {
      const primera = this.sesiones.keys().next().value;
      if (primera === undefined) break;
      this.sesiones.delete(primera);
    }
  }

  private async pedir(
    metodo: 'GET' | 'POST',
    ruta: string,
    cuerpo: string | null,
    cookies: string[],
  ): Promise<{ cuerpo: string; cookies: string[] }> {
    const cabeceras: Record<string, string> = {
      'user-agent': 'MiRevisionTecnica/1.0 (+https://mirevisionapp.cl)',
      'accept-language': 'es-CL,es;q=0.9',
    };

    if (cookies.length > 0) cabeceras.cookie = cookies.join('; ');
    if (cuerpo !== null) {
      cabeceras['content-type'] = 'application/x-www-form-urlencoded';
      cabeceras['content-length'] = String(Buffer.byteLength(cuerpo));
      cabeceras.referer = `${BASE}QRRevisionTecnica.aspx${ruta.includes('?') ? ruta.slice(ruta.indexOf('?')) : ''}`;
    }

    const ca = [...rootCertificates, await this.cadenasFaltantes()];

    return new Promise((cumplir, fallar) => {
      const peticion = pedirHttps(
        { host: HOST, path: ruta, method: metodo, headers: cabeceras, ca },
        (respuesta) => {
          const trozos: Buffer[] = [];
          let total = 0;

          respuesta.on('data', (trozo: Buffer) => {
            total += trozo.length;
            if (total > MAX_BYTES) {
              respuesta.destroy();
              fallar(new Error('la página es demasiado grande'));
              return;
            }
            trozos.push(trozo);
          });

          respuesta.on('end', () => {
            if (!respuesta.statusCode || respuesta.statusCode >= 400) {
              fallar(new Error(`el Ministerio respondió ${respuesta.statusCode}`));
              return;
            }

            const recibidas = (respuesta.headers['set-cookie'] ?? []).map(
              (galleta) => galleta.split(';')[0],
            );

            cumplir({
              cuerpo: Buffer.concat(trozos).toString('utf8'),
              cookies: recibidas.length > 0 ? recibidas : cookies,
            });
          });
        },
      );

      peticion.on('error', (error) => {
        this.logger.warn(`La ficha del Ministerio falló: ${error.message}`);
        fallar(error);
      });

      peticion.setTimeout(TIMEOUT_MS, () => {
        peticion.destroy(new Error('el Ministerio no respondió a tiempo'));
      });

      if (cuerpo !== null) peticion.write(cuerpo);
      peticion.end();
    });
  }
}

/**
 * Deja la página lista para mostrarse dentro de la app.
 *
 * La app la abre declarando que viene de `www.prt.cl`, para que el captcha siga
 * siendo el de ellos y valga. Con eso, todo lo que la página pida por su cuenta
 * --jQuery, el captcha-- se carga normal desde sus propios servidores; pero lo
 * que esté alojado en prt.cl volvería a chocar con el certificado incompleto.
 * Por eso se quitan esos recursos: son adornos de un sitio de 2011 y la consulta
 * funciona sin ellos.
 */
function prepararParaLaApp(html: string): string {
  return html.replace(
    /<(script|link|img)\b[^>]*?(?:src|href)=["'](?:\.\.\/|\/)?(?:Scripts|Estilos|Style|Imagenes|Images)\/[^"']*["'][^>]*>(?:\s*<\/script>)?/gi,
    '',
  );
}
