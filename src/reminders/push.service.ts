import { Injectable, Logger } from '@nestjs/common';
import { getMessaging, type Message } from 'firebase-admin/messaging';
import { COLLECTIONS, deviceId, type DeviceDoc } from '../firebase/collections.js';
import { FirebaseService } from '../firebase/firebase.service.js';
import { ApnsService } from './apns.service.js';

/** Un aviso listo para enviar, sin nada propio de un proveedor. */
export type PushMessage = {
  token: string;
  /** Por dónde sale: Firebase para Android, Apple para iPhone. */
  provider: 'fcm' | 'apns';
  title: string;
  body: string;
  /** FCM solo transporta texto: los valores tienen que ser strings. */
  data?: Record<string, string>;
};

/**
 * Envío de notificaciones por Firebase Cloud Messaging.
 *
 * Antes esto pasaba por el servicio de Expo, que es un intermediario delante de
 * FCM: el aviso viajaba del servidor a Expo, de Expo a FCM y recién ahí al
 * teléfono. Como el proyecto ya vive en Firebase, hablarle directo saca un
 * servicio de la ruta de entrega y una credencial que había que mantener al día
 * en dos lados.
 *
 * Los tokens que FCM da por muertos se borran en el acto. Un token vencido no
 * se recupera --el teléfono genera otro al reinstalar-- y dejarlo guardado hace
 * fallar un envío por cada corrida, para siempre.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);

  constructor(
    private readonly firebase: FirebaseService,
    private readonly apple: ApnsService,
  ) {}

  /**
   * Entrega los avisos por donde corresponda.
   *
   * Android va por Firebase y iPhone directo a Apple: iOS entrega un token de
   * APNs, que es el que Apple espera, y hacerlo pasar por Firebase obligaría a
   * meter su SDK nativo en la app solo para traducir el token.
   */
  async send(messages: PushMessage[]): Promise<number> {
    if (messages.length === 0) return 0;

    const deApple = messages.filter((mensaje) => mensaje.provider === 'apns');
    const deAndroid = messages.filter((mensaje) => mensaje.provider !== 'apns');

    let delivered = 0;

    if (deApple.length > 0) {
      const resultado = await this.apple.send(deApple);
      delivered += resultado.entregados;
      if (resultado.muertos.length > 0) await this.olvidar(resultado.muertos);
    }

    if (deAndroid.length > 0) delivered += await this.porFirebase(deAndroid);

    return delivered;
  }

  private async porFirebase(messages: PushMessage[]): Promise<number> {
    const messaging = getMessaging(this.firebase.app);
    let delivered = 0;
    const muertos: string[] = [];

    // sendEach acepta hasta 500 por llamada y devuelve un resultado por mensaje,
    // así que un token malo no arrastra a los demás del lote.
    for (const lote of enLotes(messages, 500)) {
      try {
        const respuesta = await messaging.sendEach(lote.map(armar));

        respuesta.responses.forEach((resultado, indice) => {
          if (resultado.success) {
            delivered++;
            return;
          }

          const codigo = resultado.error?.code ?? '';
          const token = lote[indice]?.token;

          if (token && esTokenMuerto(codigo)) {
            muertos.push(token);
          } else {
            this.logger.warn(`Push rechazado (${codigo}): ${resultado.error?.message}`);
          }
        });
      } catch (error) {
        this.logger.error(`No se pudo enviar un lote de push: ${describir(error)}`);
      }
    }

    if (muertos.length > 0) await this.olvidar(muertos);

    return delivered;
  }

  /** Borra los aparatos cuyo token ya no sirve. */
  private async olvidar(tokens: string[]): Promise<void> {
    const lote = this.firebase.db.batch();
    tokens.forEach((token) =>
      lote.delete(this.firebase.db.collection(COLLECTIONS.devices).doc(deviceId(token))),
    );

    await lote.commit();
    this.logger.log(`${tokens.length} token(s) dados de baja: ya no existen en su servicio`);
  }

  /** Los aparatos de un usuario a los que se les puede entregar. */
  async tokensDe(userId: string): Promise<Destino[]> {
    const snapshot = await this.firebase.db
      .collection(COLLECTIONS.devices)
      .where('userId', '==', userId)
      .get();

    const aparatos = snapshot.docs.map((doc) => doc.data() as DeviceDoc);

    if (!this.apple.disponible && aparatos.some((aparato) => aparato.provider === 'apns')) {
      this.logger.warn(
        'Hay aparatos de iPhone y no está configurada la clave de APNs: esos avisos no saldrán.',
      );
    }

    return aparatos
      .filter((aparato) => Boolean(aparato.token))
      .map((aparato) => ({ token: aparato.token, provider: aparato.provider }));
  }
}

/** Un aparato al que se le puede entregar, con la puerta por la que se entra. */
export type Destino = { token: string; provider: 'fcm' | 'apns' };

function armar(mensaje: PushMessage): Message {
  return {
    token: mensaje.token,
    notification: { title: mensaje.title, body: mensaje.body },
    data: mensaje.data,
    android: {
      // Alta, porque un vencimiento es justo lo que no debe quedarse esperando
      // a que el teléfono despierte por su cuenta.
      priority: 'high',
      notification: {
        channelId: 'vencimientos',
        sound: 'default',
      },
    },
    apns: {
      payload: {
        aps: {
          sound: 'default',
          contentAvailable: true,
        },
      },
    },
  };
}

/** Códigos con los que FCM dice que ese token ya no existe. */
function esTokenMuerto(codigo: string): boolean {
  return (
    codigo === 'messaging/registration-token-not-registered' ||
    codigo === 'messaging/invalid-registration-token' ||
    codigo === 'messaging/invalid-argument'
  );
}

function enLotes<T>(items: T[], tamano: number): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < items.length; i += tamano) lotes.push(items.slice(i, i + tamano));
  return lotes;
}

function describir(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
