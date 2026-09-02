/**
 * Refresca el catálogo de plantas desde Google Places, a mano.
 *
 * Uso:  npm run enrich:plants          (prueba en seco: solo muestra)
 *       npm run enrich:plants -- --write   (escribe en Firestore y en el JSON)
 *
 * El servicio hace lo mismo solo una vez al mes; este comando existe para
 * forzarlo tras editar el listado o para revisar qué devuelve Google.
 * La lógica vive en src/plants/places-refresh.ts, compartida con el cron.
 */
import 'dotenv/config';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  applicationDefault,
  cert,
  getApps,
  initializeApp,
  type ServiceAccount,
} from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import {
  readSeed,
  refreshFromPlaces,
  saveToFirestore,
  writeSeed,
} from '../plants/places-refresh.js';

const KEY = process.env.GOOGLE_MAPS_API_KEY;
const WRITE = process.argv.includes('--write');

if (!KEY) {
  console.error(
    'Falta GOOGLE_MAPS_API_KEY.\n' +
      'Habilita "Places API (New)" en la consola de Google Cloud del proyecto\n' +
      'mi-revision-tecnica, crea una clave y ponla en el .env.',
  );
  process.exit(1);
}

function credentials() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return { credential: applicationDefault() };

  const base64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  if (base64) {
    return {
      credential: cert(JSON.parse(Buffer.from(base64, 'base64').toString('utf8')) as ServiceAccount),
    };
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

  throw new Error('Faltan las credenciales de Firebase. Ver README.md.');
}

// Se resuelve desde la raíz del proyecto y no desde import.meta.url: el
// comando corre compilado desde dist/, y ahí la ruta relativa apuntaría a
// la copia del build en vez del archivo fuente que sí se versiona.
const file = pathToFileURL(resolve(process.cwd(), 'src/data/plants.json'));
const seed = await readSeed(file);

const { plants, result } = await refreshFromPlaces(seed, KEY, (line) => console.log(line));

console.log(
  `\nResumen: ${result.withSchedule}/${result.total} con horario, ` +
    `${result.withPhone} con teléfono, ${result.moved} coordenadas corregidas, ` +
    `${result.notFound.length} sin resultado.`,
);

if (result.closed.length > 0) {
  console.log(`⚠ Cerradas permanentemente según Google: ${result.closed.join(', ')}`);
}

if (!WRITE) {
  console.log('\nPrueba en seco. Repite con  --write  para guardar.');
  process.exit(0);
}

await writeSeed(file, plants);
await saveToFirestore(getFirestore(getApps()[0] ?? initializeApp(credentials())), plants);

console.log('Firestore y src/data/plants.json actualizados.');
process.exit(0);
