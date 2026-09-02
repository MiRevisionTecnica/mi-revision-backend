import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { daysUntil, statusFor, toDateOnly, toIsoDate } from '../common/dates.js';
import type { DocumentKind } from '../common/enums.js';
import { COLLECTIONS, type VehicleDoc } from '../firebase/collections.js';
import { FirebaseService } from '../firebase/firebase.service.js';
import type { CreateVehicleDto, ExpirationDto, UpdateVehicleDto, VehicleResponse } from './dto/vehicle.dto.js';

type StoredVehicle = VehicleDoc & { id: string };

@Injectable()
export class VehiclesService {
  constructor(
    private readonly firebase: FirebaseService,
    private readonly config: ConfigService,
  ) {}

  async list(userId: string): Promise<VehicleResponse[]> {
    const snapshot = await this.firebase.db
      .collection(COLLECTIONS.vehicles)
      .where('userId', '==', userId)
      .get();

    return snapshot.docs
      .map((doc) => toResponse({ id: doc.id, ...(doc.data() as VehicleDoc) }))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async findOne(userId: string, id: string): Promise<VehicleResponse> {
    return toResponse(await this.getOwned(userId, id));
  }

  async create(userId: string, dto: CreateVehicleDto): Promise<VehicleResponse> {
    const limit = this.config.get<number>('MAX_VEHICLES_PER_USER', 1);
    const db = this.firebase.db;
    const plate = dto.plate.toUpperCase();
    const expirations = toExpirationMap(dto.expirations);
    const now = new Date().toISOString();
    const ref = db.collection(COLLECTIONS.vehicles).doc();

    // El límite del plan y la unicidad de la patente se verifican dentro de la
    // transacción: sin eso, dos peticiones simultáneas podrían saltarse ambos.
    const vehicle = await db.runTransaction(async (tx) => {
      const owned = await tx.get(
        db.collection(COLLECTIONS.vehicles).where('userId', '==', userId),
      );

      if (owned.size >= limit) {
        throw new ForbiddenException(
          `Tu plan permite ${limit} ${limit === 1 ? 'vehículo' : 'vehículos'}.`,
        );
      }

      if (owned.docs.some((doc) => (doc.data() as VehicleDoc).plate === plate)) {
        throw new ForbiddenException('Ya registraste un vehículo con esa patente.');
      }

      const data: VehicleDoc = {
        userId,
        plate,
        brand: dto.brand.trim(),
        model: dto.model.trim(),
        year: dto.year ?? null,
        expirations,
        dueDates: Object.values(expirations),
        createdAt: now,
        updatedAt: now,
      };

      tx.set(ref, data);
      return { id: ref.id, ...data };
    });

    return toResponse(vehicle);
  }

  async update(userId: string, id: string, dto: UpdateVehicleDto): Promise<VehicleResponse> {
    const current = await this.getOwned(userId, id);

    // Si vienen fechas, reemplazan por completo a las existentes.
    const expirations = dto.expirations ? toExpirationMap(dto.expirations) : current.expirations;

    const data: Partial<VehicleDoc> = {
      ...(dto.plate !== undefined ? { plate: dto.plate.toUpperCase() } : {}),
      ...(dto.brand !== undefined ? { brand: dto.brand.trim() } : {}),
      ...(dto.model !== undefined ? { model: dto.model.trim() } : {}),
      ...(dto.year !== undefined ? { year: dto.year } : {}),
      ...(dto.expirations ? { expirations, dueDates: Object.values(expirations) } : {}),
      updatedAt: new Date().toISOString(),
    };

    await this.firebase.db.collection(COLLECTIONS.vehicles).doc(id).update(data);

    return toResponse({ ...current, ...data } as StoredVehicle);
  }

  /** Borra el vehículo y sus documentos: Firestore no tiene cascada. */
  async remove(userId: string, id: string): Promise<void> {
    await this.getOwned(userId, id);
    const db = this.firebase.db;

    const documents = await db
      .collection(COLLECTIONS.documents)
      .where('vehicleId', '==', id)
      .get();

    const batch = db.batch();
    documents.docs.forEach((doc) => batch.delete(doc.ref));
    batch.delete(db.collection(COLLECTIONS.vehicles).doc(id));
    await batch.commit();
  }

  /** Verifica que el vehículo exista y sea del usuario que consulta. */
  private async getOwned(userId: string, id: string): Promise<StoredVehicle> {
    const snapshot = await this.firebase.db.collection(COLLECTIONS.vehicles).doc(id).get();
    const data = snapshot.data() as VehicleDoc | undefined;

    if (!data || data.userId !== userId) {
      throw new NotFoundException('No encontramos ese vehículo.');
    }

    return { id: snapshot.id, ...data };
  }
}

function toExpirationMap(items: ExpirationDto[] = []): Partial<Record<DocumentKind, string>> {
  const map: Partial<Record<DocumentKind, string>> = {};
  for (const item of items) {
    map[item.kind] = toIsoDate(toDateOnly(item.dueDate));
  }
  return map;
}

function toResponse(vehicle: StoredVehicle): VehicleResponse {
  const expirations = Object.entries(vehicle.expirations ?? {}) as [DocumentKind, string][];

  return {
    id: vehicle.id,
    plate: vehicle.plate,
    brand: vehicle.brand,
    model: vehicle.model,
    year: vehicle.year,
    createdAt: new Date(vehicle.createdAt),
    expirations: expirations
      .map(([kind, dueDate]) => ({
        kind,
        dueDate,
        daysRemaining: daysUntil(toDateOnly(dueDate)),
        status: statusFor(toDateOnly(dueDate)),
      }))
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
  };
}
