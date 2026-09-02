/**
 * Carga el catálogo de plantas PRT de la Región Metropolitana en Firestore.
 *
 * src/data/plants.json es el mismo archivo que usa la app móvil; sus coordenadas
 * se obtuvieron con Nominatim/OpenStreetMap. Es un upsert, así que se puede
 * ejecutar de nuevo en cada despliegue sin duplicar nada.
 *
 * Uso: npm run seed
 */
import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import {
  applicationDefault,
  cert,
  getApps,
  initializeApp,
  type ServiceAccount,
} from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

type RawPlant = {
  id: string;
  company: string;
  comuna: string;
  address: string;
  classes: string[];
  lat?: number;
  lng?: number;
  precision?: string;
  phone?: string | null;
  schedule?: Record<string, { open: string; close: string }[]> | null;
  scheduleSource?: string | null;
  placeId?: string | null;
};

function credentials() {
  // firebase-admin lee GOOGLE_APPLICATION_CREDENTIALS por su cuenta.
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return { credential: applicationDefault() };
  }

  const base64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  if (base64) {
    const json = JSON.parse(Buffer.from(base64, 'base64').toString('utf8')) as ServiceAccount;
    return { credential: cert(json) };
  }

  const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } = process.env;
  if (FIREBASE_PROJECT_ID && FIREBASE_CLIENT_EMAIL && FIREBASE_PRIVATE_KEY) {
    return {
      credential: cert({
        projectId: FIREBASE_PROJECT_ID,
        clientEmail: FIREBASE_CLIENT_EMAIL,
        privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
    };
  }

  throw new Error(
    'Faltan las credenciales de Firebase. Define GOOGLE_APPLICATION_CREDENTIALS, ' +
      'FIREBASE_SERVICE_ACCOUNT_BASE64, o los tres campos por separado. Ver README.md.',
  );
}

/** Minúsculas y sin tildes, para poder buscar "nunoa" y encontrar "Ñuñoa". */
function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

const app = getApps()[0] ?? initializeApp(credentials());
const db = getFirestore(app);

const file = new URL('../data/plants.json', import.meta.url);
const plants = JSON.parse(await readFile(file, 'utf8')) as RawPlant[];

const usable = plants.filter(
  (plant): plant is RawPlant & { lat: number; lng: number } =>
    typeof plant.lat === 'number' && typeof plant.lng === 'number',
);

// Un batch admite hasta 500 operaciones; el catálogo cabe de sobra.
const batch = db.batch();
const now = new Date().toISOString();

for (const plant of usable) {
  batch.set(db.collection('plants').doc(plant.id), {
    company: plant.company,
    comuna: plant.comuna,
    comunaSearch: normalize(plant.comuna),
    address: plant.address,
    lat: plant.lat,
    lng: plant.lng,
    classes: plant.classes,
    phone: plant.phone ?? null,
    schedule: plant.schedule ?? null,
    scheduleSource: plant.scheduleSource ?? null,
    placeId: plant.placeId ?? null,
    precision: plant.precision ?? 'address',
    updatedAt: now,
  });
}

await batch.commit();

const skipped = plants.length - usable.length;
console.log(
  `Plantas cargadas en Firestore: ${usable.length}` +
    (skipped > 0 ? ` (${skipped} sin coordenadas, omitidas)` : ''),
);

process.exit(0);
