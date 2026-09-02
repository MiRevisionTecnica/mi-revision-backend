import { readFile, writeFile } from 'node:fs/promises';
import type { Firestore } from 'firebase-admin/firestore';
import type { WeeklySchedule } from '../firebase/collections.js';

/**
 * Refresco del catálogo de plantas desde Google Places: coordenadas del propio
 * negocio, horario de atención, teléfono y si sigue funcionando.
 *
 * Vive fuera de Nest a propósito, para que lo usen tanto el cron mensual como
 * el comando `npm run enrich:plants` sin duplicar la lógica.
 *
 * Costo: dos llamadas por planta (buscar + detalle). Con 38 plantas son 76 al
 * mes, muy por debajo del free tier de 10.000 por SKU. El `placeId` queda
 * guardado, así que a partir de la segunda corrida solo se gasta el detalle.
 */

const API = 'https://places.googleapis.com/v1';
const DAYS: (keyof WeeklySchedule)[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export type PlantSeed = {
  id: string;
  company: string;
  comuna: string;
  address: string;
  classes: string[];
  lat?: number;
  lng?: number;
  precision?: string;
  phone?: string | null;
  schedule?: WeeklySchedule | null;
  scheduleSource?: string | null;
  placeId?: string | null;
  /** 'operational' | 'closed'. Las cerradas no se muestran en la app. */
  status?: string;
};

export type RefreshResult = {
  total: number;
  withSchedule: number;
  withPhone: number;
  moved: number;
  closed: string[];
  notFound: string[];
};

type PlaceDetails = {
  location?: { latitude: number; longitude: number };
  nationalPhoneNumber?: string;
  regularOpeningHours?: {
    periods?: {
      open?: { day: number; hour: number; minute: number };
      close?: { day: number; hour: number; minute: number };
    }[];
  };
  businessStatus?: string;
};

async function findPlaceId(plant: PlantSeed, key: string): Promise<string | null> {
  const res = await fetch(`${API}/places:searchText`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      // Pedir solo el id mantiene esta llamada en el SKU más barato.
      'X-Goog-FieldMask': 'places.id',
    },
    body: JSON.stringify({
      textQuery: `${plant.company} revisión técnica ${plant.address}, ${plant.comuna}`,
      languageCode: 'es',
      regionCode: 'CL',
      maxResultCount: 1,
    }),
  });

  if (!res.ok) return null;

  const data = (await res.json()) as { places?: { id: string }[] };
  return data.places?.[0]?.id ?? null;
}

async function fetchDetails(placeId: string, key: string): Promise<PlaceDetails | null> {
  const res = await fetch(`${API}/places/${placeId}`, {
    headers: {
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'location,nationalPhoneNumber,regularOpeningHours,businessStatus',
      'Accept-Language': 'es',
    },
  });

  return res.ok ? ((await res.json()) as PlaceDetails) : null;
}

const hhmm = (hour: number, minute: number) =>
  `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

function toSchedule(details: PlaceDetails): WeeklySchedule | null {
  const periods = details.regularOpeningHours?.periods;
  if (!periods?.length) return null;

  const week: WeeklySchedule = {
    mon: [],
    tue: [],
    wed: [],
    thu: [],
    fri: [],
    sat: [],
    sun: [],
  };

  for (const period of periods) {
    if (!period.open) continue;

    const day = DAYS[period.open.day];
    if (!day) continue;

    week[day].push({
      open: hhmm(period.open.hour, period.open.minute),
      // Sin `close`, Places indica atención de 24 horas ese día.
      close: period.close ? hhmm(period.close.hour, period.close.minute) : '23:59',
    });
  }

  return week;
}

export function distanceKm(a: { lat?: number; lng?: number }, b: { lat: number; lng: number }): number {
  if (a.lat === undefined || a.lng === undefined) return 0;

  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;

  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

/**
 * Consulta Places para cada planta y devuelve el listado actualizado.
 * No escribe nada: quien llama decide si persistir.
 */
export async function refreshFromPlaces(
  plants: PlantSeed[],
  key: string,
  onProgress?: (line: string) => void,
): Promise<{ plants: PlantSeed[]; result: RefreshResult }> {
  const result: RefreshResult = {
    total: plants.length,
    withSchedule: 0,
    withPhone: 0,
    moved: 0,
    closed: [],
    notFound: [],
  };

  for (const plant of plants) {
    const placeId = plant.placeId ?? (await findPlaceId(plant, key));

    if (!placeId) {
      result.notFound.push(plant.id);
      onProgress?.(`✗ ${plant.id} ${plant.company} — ${plant.comuna}: no está en Places`);
      continue;
    }

    const details = await fetchDetails(placeId, key);
    if (!details) {
      result.notFound.push(plant.id);
      continue;
    }

    plant.placeId = placeId;

    if (details.location) {
      const movida = distanceKm(plant, {
        lat: details.location.latitude,
        lng: details.location.longitude,
      });

      plant.lat = Number(details.location.latitude.toFixed(6));
      plant.lng = Number(details.location.longitude.toFixed(6));
      plant.precision = 'places';
      if (movida > 0.1) result.moved++;
    }

    const schedule = toSchedule(details);
    if (schedule) {
      plant.schedule = schedule;
      plant.scheduleSource = 'google-places';
      result.withSchedule++;
    }

    if (details.nationalPhoneNumber) {
      plant.phone = details.nationalPhoneNumber;
      result.withPhone++;
    }

    // Google marca las que cerraron. Seguir mostrándolas manda gente a la nada.
    const operativa = !details.businessStatus || details.businessStatus === 'OPERATIONAL';
    plant.status = operativa ? 'operational' : 'closed';
    if (!operativa) result.closed.push(plant.id);

    onProgress?.(
      `✔ ${plant.id} ${plant.company} — ${plant.comuna}` +
        `${schedule ? ' | horario' : ' | sin horario'}` +
        `${details.nationalPhoneNumber ? ' | teléfono' : ''}` +
        `${operativa ? '' : ` | ⚠ ${details.businessStatus}`}`,
    );
  }

  return { plants, result };
}

/** Guarda el catálogo en Firestore. */
export async function saveToFirestore(db: Firestore, plants: PlantSeed[]): Promise<void> {
  const batch = db.batch();
  const now = new Date().toISOString();

  for (const plant of plants) {
    batch.set(
      db.collection('plants').doc(plant.id),
      {
        phone: plant.phone ?? null,
        schedule: plant.schedule ?? null,
        scheduleSource: plant.scheduleSource ?? null,
        placeId: plant.placeId ?? null,
        status: plant.status ?? 'operational',
        ...(plant.lat && plant.lng
          ? { lat: plant.lat, lng: plant.lng, precision: plant.precision }
          : {}),
        updatedAt: now,
      },
      { merge: true },
    );
  }

  await batch.commit();
}

export async function readSeed(url: URL): Promise<PlantSeed[]> {
  return JSON.parse(await readFile(url, 'utf8')) as PlantSeed[];
}

export async function writeSeed(url: URL, plants: PlantSeed[]): Promise<void> {
  await writeFile(url, `${JSON.stringify(plants, null, 2)}\n`, 'utf8');
}
