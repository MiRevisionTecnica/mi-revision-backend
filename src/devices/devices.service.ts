import { Injectable, NotFoundException } from '@nestjs/common';
import { COLLECTIONS, deviceId, type DeviceDoc } from '../firebase/collections.js';
import { FirebaseService } from '../firebase/firebase.service.js';
import type { DeviceResponse, RegisterDeviceDto } from './dto/device.dto.js';

@Injectable()
export class DevicesService {
  constructor(private readonly firebase: FirebaseService) {}

  /**
   * El id del documento es el hash del token, así que registrar dos veces el
   * mismo teléfono no duplica nada. Si el token aparece en otra cuenta (pasa
   * cuando dos personas usan el mismo aparato), se reasigna al usuario actual.
   */
  async register(userId: string, dto: RegisterDeviceDto): Promise<DeviceResponse> {
    const id = deviceId(dto.pushToken);
    const ref = this.firebase.db.collection(COLLECTIONS.devices).doc(id);
    const existing = await ref.get();
    const now = new Date().toISOString();

    const data: DeviceDoc = {
      userId,
      token: dto.pushToken,
      provider: dto.provider,
      platform: dto.platform ?? null,
      lastSeenAt: now,
      createdAt: (existing.data() as DeviceDoc | undefined)?.createdAt ?? now,
    };

    await ref.set(data);
    return toResponse(id, data);
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

  /** Acepta el token, no el id: es lo único que la app tiene a mano. */
  async remove(userId: string, pushToken: string): Promise<void> {
    const ref = this.firebase.db.collection(COLLECTIONS.devices).doc(deviceId(pushToken));
    const snapshot = await ref.get();
    const data = snapshot.data() as DeviceDoc | undefined;

    if (!data || data.userId !== userId) {
      throw new NotFoundException('Ese dispositivo no está registrado.');
    }

    await ref.delete();
  }
}

function toResponse(id: string, device: DeviceDoc): DeviceResponse {
  return {
    id,
    provider: device.provider,
    platform: device.platform,
    lastSeenAt: new Date(device.lastSeenAt),
  };
}
