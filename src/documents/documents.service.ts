import { Injectable, NotFoundException } from '@nestjs/common';
import { DocumentKind } from '../common/enums.js';
import { COLLECTIONS, type DocumentDoc, type VehicleDoc } from '../firebase/collections.js';
import { FirebaseService } from '../firebase/firebase.service.js';
import type { CreateDocumentDto, DocumentResponse } from './dto/document.dto.js';

/**
 * Metadatos de los documentos del vehículo. En la Fase 1 el archivo vive en el
 * teléfono (carpeta privada de la app); aquí se registra qué tiene guardado el
 * usuario para poder sincronizarlo cuando exista almacenamiento en la nube.
 */
@Injectable()
export class DocumentsService {
  constructor(private readonly firebase: FirebaseService) {}

  async listByVehicle(userId: string, vehicleId: string): Promise<DocumentResponse[]> {
    await this.assertOwnership(userId, vehicleId);

    const snapshot = await this.firebase.db
      .collection(COLLECTIONS.documents)
      .where('vehicleId', '==', vehicleId)
      .get();

    return snapshot.docs
      .map((doc) => toResponse(doc.id, doc.data() as DocumentDoc))
      .sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime());
  }

  async create(
    userId: string,
    vehicleId: string,
    dto: CreateDocumentDto,
  ): Promise<DocumentResponse> {
    await this.assertOwnership(userId, vehicleId);
    const db = this.firebase.db;

    // Fase 1: un archivo por cada tipo con vencimiento, el nuevo reemplaza al
    // anterior. "OTRO" es el cajón libre y admite varios.
    if (dto.kind !== DocumentKind.OTRO) {
      const previous = await db
        .collection(COLLECTIONS.documents)
        .where('vehicleId', '==', vehicleId)
        .where('kind', '==', dto.kind)
        .get();

      if (!previous.empty) {
        const batch = db.batch();
        previous.docs.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
      }
    }

    const data: DocumentDoc = {
      vehicleId,
      userId,
      kind: dto.kind,
      name: dto.name.trim(),
      mimeType: dto.mimeType ?? null,
      size: dto.size ?? null,
      storageUrl: dto.storageUrl ?? null,
      uploadedAt: new Date().toISOString(),
    };

    const ref = await db.collection(COLLECTIONS.documents).add(data);
    return toResponse(ref.id, data);
  }

  async remove(userId: string, id: string): Promise<void> {
    const ref = this.firebase.db.collection(COLLECTIONS.documents).doc(id);
    const snapshot = await ref.get();
    const data = snapshot.data() as DocumentDoc | undefined;

    if (!data || data.userId !== userId) {
      throw new NotFoundException('No encontramos ese documento.');
    }

    await ref.delete();
  }

  private async assertOwnership(userId: string, vehicleId: string): Promise<void> {
    const snapshot = await this.firebase.db
      .collection(COLLECTIONS.vehicles)
      .doc(vehicleId)
      .get();

    const data = snapshot.data() as VehicleDoc | undefined;
    if (!data || data.userId !== userId) {
      throw new NotFoundException('No encontramos ese vehículo.');
    }
  }
}

function toResponse(id: string, document: DocumentDoc): DocumentResponse {
  return {
    id,
    vehicleId: document.vehicleId,
    kind: document.kind,
    name: document.name,
    mimeType: document.mimeType,
    size: document.size,
    storageUrl: document.storageUrl,
    uploadedAt: new Date(document.uploadedAt),
  };
}
