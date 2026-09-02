import { Injectable, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { COLLECTIONS, type PlantDoc } from '../firebase/collections.js';
import { FirebaseService } from '../firebase/firebase.service.js';
import type { PlantResponse, SearchPlantsDto } from './dto/plant.dto.js';

const DEFAULT_LIMIT = 50;
/** El catálogo son decenas de filas y casi no cambia: se cachea en memoria. */
const CACHE_TTL_MS = 10 * 60 * 1000;

type StoredPlant = PlantDoc & { id: string };

@Injectable()
export class PlantsService implements OnModuleInit {
  private cache: StoredPlant[] = [];
  private cachedAt = 0;

  constructor(private readonly firebase: FirebaseService) {}

  onModuleInit(): void {
    // Precarga en segundo plano: si falla, la primera consulta lo reintenta.
    void this.all().catch(() => undefined);
  }

  async comunas(): Promise<string[]> {
    const plants = await this.all();
    return [...new Set(plants.map((plant) => plant.comuna))].sort((a, b) =>
      a.localeCompare(b, 'es'),
    );
  }

  /**
   * Firestore no sabe buscar texto parcial ni ordenar por distancia, así que el
   * filtrado se hace en memoria sobre el catálogo cacheado. Con ~40 plantas es
   * más rápido y más barato que cualquier consulta compuesta.
   */
  async search(query: SearchPlantsDto): Promise<PlantResponse[]> {
    const limit = query.limit ?? DEFAULT_LIMIT;
    const text = normalize(query.q ?? '');
    const comuna = query.comuna ? normalize(query.comuna) : null;

    const filtered = (await this.all()).filter((plant) => {
      if (comuna && plant.comunaSearch !== comuna) return false;
      if (!text) return true;
      return (
        plant.comunaSearch.includes(text) ||
        normalize(plant.address).includes(text) ||
        normalize(plant.company).includes(text)
      );
    });

    const hasOrigin = query.lat !== undefined && query.lng !== undefined;
    if (!hasOrigin) {
      return filtered
        .sort((a, b) => a.comuna.localeCompare(b.comuna, 'es') || a.company.localeCompare(b.company))
        .slice(0, limit)
        .map((plant) => toResponse(plant));
    }

    const origin = { lat: query.lat!, lng: query.lng! };
    return filtered
      .map((plant) => ({ plant, distance: distanceKm(origin, plant) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, limit)
      .map(({ plant, distance }) => toResponse(plant, distance));
  }

  async findOne(id: string): Promise<PlantResponse> {
    const snapshot = await this.firebase.db.collection(COLLECTIONS.plants).doc(id).get();
    const data = snapshot.data() as PlantDoc | undefined;

    if (!data) throw new NotFoundException('No encontramos esa planta.');
    return toResponse({ id: snapshot.id, ...data });
  }

  /** El refresco mensual llama a esto para que la próxima consulta lea de nuevo. */
  invalidateCache(): void {
    this.cache = [];
    this.cachedAt = 0;
  }

  private async all(): Promise<StoredPlant[]> {
    if (this.cache.length > 0 && Date.now() - this.cachedAt < CACHE_TTL_MS) {
      return this.cache;
    }

    const snapshot = await this.firebase.db.collection(COLLECTIONS.plants).get();

    // Las que Google marca como cerradas no se muestran: mandar a alguien a una
    // planta que ya no existe es peor que no listarla.
    this.cache = snapshot.docs
      .map((doc) => ({ id: doc.id, ...(doc.data() as PlantDoc) }))
      .filter((plant) => (plant.status ?? 'operational') !== 'closed');
    this.cachedAt = Date.now();

    return this.cache;
  }
}

function toResponse(plant: StoredPlant, distance?: number): PlantResponse {
  return {
    id: plant.id,
    company: plant.company,
    comuna: plant.comuna,
    address: plant.address,
    lat: plant.lat,
    lng: plant.lng,
    classes: plant.classes,
    phone: plant.phone,
    schedule: plant.schedule,
    scheduleSource: plant.scheduleSource ?? null,
    precision: plant.precision ?? 'address',
    ...(distance !== undefined ? { distanceKm: Number(distance.toFixed(2)) } : {}),
  };
}

/** Minúsculas y sin tildes, para buscar "nunoa" y encontrar "Ñuñoa". */
export function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/** Distancia en kilómetros entre dos coordenadas (fórmula de Haversine). */
function distanceKm(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): number {
  const R = 6371;
  const dLat = ((to.lat - from.lat) * Math.PI) / 180;
  const dLng = ((to.lng - from.lng) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((from.lat * Math.PI) / 180) *
      Math.cos((to.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
