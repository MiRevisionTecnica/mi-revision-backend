import { Injectable, Logger } from '@nestjs/common';
import { getMessaging, type Message } from 'firebase-admin/messaging';
import { COLLECTIONS, deviceId, type DeviceDoc } from '../firebase/collections.js';
import { FirebaseService } from '../firebase/firebase.service.js';

/** Un aviso listo para enviar, sin nada propio de un proveedor. */
export type PushMessage = {
  token: string;
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

  constructor(private readonly firebase: FirebaseService) {}

  async send(messages: PushMessage[]): Promise<number> {
    if (messages.length === 0) return 0;

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

  /** Borra los aparatos cuyo token FCM ya no sirve. */
  private async olvidar(tokens: string[]): Promise<void> {
    const lote = this.firebase.db.batch();
    tokens.forEach((token) =>
      lote.delete(this.firebase.db.collection(COLLECTIONS.devices).doc(deviceId(token))),
    );

    await lote.commit();
    this.logger.log(`${tokens.length} token(s) dados de baja: FCM los reporta como inválidos`);
  }

  /** Los aparatos de un usuario a los que se les puede entregar hoy. */
  async tokensDe(userId: string): Promise<string[]> {
    const snapshot = await this.firebase.db
      .collection(COLLECTIONS.devices)
      .where('userId', '==', userId)
      .get();

    const aparatos = snapshot.docs.map((doc) => doc.data() as DeviceDoc);

    // Los de Apple se guardan pero todavía no se pueden entregar: el token que
    // da iOS es de APNs, y FCM necesita el suyo. Se avisa en vez de perderlos en
    // silencio, para que el día que exista la app de iOS se note qué falta.
    const apple = aparatos.filter((aparato) => aparato.provider === 'apns');
    if (apple.length > 0) {
      this.logger.warn(
        `${apple.length} aparato(s) de iOS sin ruta de entrega: falta el SDK de Firebase en la ` +
          'app de Apple para obtener un token de FCM. Ver README.md → "Notificaciones en iOS".',
      );
    }

    return aparatos
      .filter((aparato) => aparato.provider === 'fcm' && Boolean(aparato.token))
      .map((aparato) => aparato.token);
  }
}

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
