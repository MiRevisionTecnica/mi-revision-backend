import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Expo, type ExpoPushMessage, type ExpoPushTicket } from 'expo-server-sdk';
import { COLLECTIONS } from '../firebase/collections.js';
import { FirebaseService } from '../firebase/firebase.service.js';

/**
 * Envío de push a través del servicio de Expo. Un token que Expo reporta como
 * inválido (`DeviceNotRegistered`) se borra, para no seguir gastando envíos.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private readonly expo: Expo;

  constructor(
    config: ConfigService,
    private readonly firebase: FirebaseService,
  ) {
    this.expo = new Expo({ accessToken: config.get<string>('EXPO_ACCESS_TOKEN') });
  }

  async send(messages: ExpoPushMessage[]): Promise<number> {
    const valid = messages.filter((message) => {
      const to = Array.isArray(message.to) ? message.to[0] : message.to;
      return Expo.isExpoPushToken(to);
    });

    if (valid.length === 0) return 0;

    let delivered = 0;

    for (const chunk of this.expo.chunkPushNotifications(valid)) {
      try {
        const tickets = await this.expo.sendPushNotificationsAsync(chunk);
        delivered += await this.handleTickets(chunk, tickets);
      } catch (error) {
        this.logger.error(`No se pudo enviar un lote de push: ${describe(error)}`);
      }
    }

    return delivered;
  }

  private async handleTickets(
    chunk: ExpoPushMessage[],
    tickets: ExpoPushTicket[],
  ): Promise<number> {
    let delivered = 0;
    const expiredTokens: string[] = [];

    tickets.forEach((ticket, index) => {
      if (ticket.status === 'ok') {
        delivered++;
        return;
      }

      const message = chunk[index];
      const to = Array.isArray(message?.to) ? message.to[0] : message?.to;

      if (ticket.details?.error === 'DeviceNotRegistered' && to) {
        expiredTokens.push(to);
      } else {
        this.logger.warn(`Push rechazado: ${ticket.message}`);
      }
    });

    if (expiredTokens.length > 0) {
      const batch = this.firebase.db.batch();
      expiredTokens.forEach((token) =>
        batch.delete(this.firebase.db.collection(COLLECTIONS.devices).doc(token)),
      );
      await batch.commit();
      this.logger.log(`${expiredTokens.length} token(s) dados de baja por Expo`);
    }

    return delivered;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
