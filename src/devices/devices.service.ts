import { Injectable, NotFoundException } from '@nestjs/common';
import { COLLECTIONS, type DeviceDoc } from '../firebase/collections.js';
import { FirebaseService } from '../firebase/firebase.service.js';
import type { DeviceResponse, RegisterDeviceDto } from './dto/device.dto.js';

@Injectable()
export class DevicesService {
  constructor(private readonly firebase: FirebaseService) {}

  /**
   * El token de push es el id del documento, así que registrar dos veces el
   * mismo teléfono no duplica nada. Si el token aparece en otra cuenta (pasa
   * cuando dos personas usan el mismo aparato), se reasigna al usuario actual.
   */
  async register(userId: string, dto: RegisterDeviceDto): Promise<DeviceResponse> {
    const ref = this.firebase.db.collection(COLLECTIONS.devices).doc(dto.expoPushToken);
    const existing = await ref.get();
    const now = new Date().toISOString();

    const data: DeviceDoc = {
      userId,
      platform: dto.platform ?? null,
      lastSeenAt: now,
      createdAt: (existing.data() as DeviceDoc | undefined)?.createdAt ?? now,
    };

    await ref.set(data);
    return toResponse(dto.expoPushToken, data);
  }

  async list(userId: string): Promise<DeviceResponse[]> {
    const snapshot = await this.firebase.db
      .collection(COLLECTIONS.devices)
      .where('userId', '==', userId)
      .get();

    return snapshot.docs
      .map((doc) => toResponse(doc.id, doc.data() as DeviceDoc))
      .sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime());
  }

  async remove(userId: string, expoPushToken: string): Promise<void> {
    const ref = this.firebase.db.collection(COLLECTIONS.devices).doc(expoPushToken);
    const snapshot = await ref.get();
    const data = snapshot.data() as DeviceDoc | undefined;

    if (!data || data.userId !== userId) {
      throw new NotFoundException('Ese dispositivo no está registrado.');
    }

    await ref.delete();
  }
}

function toResponse(expoPushToken: string, device: DeviceDoc): DeviceResponse {
  return {
    id: expoPushToken,
    expoPushToken,
    platform: device.platform,
    lastSeenAt: new Date(device.lastSeenAt),
  };
}
