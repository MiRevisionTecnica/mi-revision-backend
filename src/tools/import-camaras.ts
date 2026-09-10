/**
 * Carga los enlaces a las cámaras de los patios.
 *
 * Uso:  npm run camaras            (prueba en seco: solo muestra)
 *       npm run camaras -- --write (escribe en Firestore y en el JSON)
 *
 * El dato vive en src/data/camaras.json, mapeado por empresa: las
 * concesionarias publican una página con las cámaras de todas sus plantas, no
 * una por planta. Agregar una empresa es una línea en ese archivo.
 */
import 'dotenv/config';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  applicationDefault,
  cert,
  getApps,
  initializeApp,
  type ServiceAccount,
} from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const WRITE = process.argv.includes('--write');

type PlantaLocal = {
  id: string;
  company: string;
  comuna: string;
  cameraUrl?: string | null;
  [clave: string]: unknown;
};

type Camaras = {
  porEmpresa: Record<string, string>;
  omitir: string[];
};

function credenciales() {
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

const raiz = process.cwd();
const archivoSemilla = resolve(raiz, 'src/data/plants.json');

const camaras = JSON.parse(await readFile(resolve(raiz, 'src/data/camaras.json'), 'utf8')) as Camaras;
const plantas = JSON.parse(await readFile(archivoSemilla, 'utf8')) as PlantaLocal[];

const omitidas = new Set(camaras.omitir);
const sinCamara = new Map<string, number>();
let conCamara = 0;

for (const planta of plantas) {
  const url = camaras.porEmpresa[planta.company];

  if (!url || omitidas.has(planta.id)) {
    planta.cameraUrl = null;
    if (!url) sinCamara.set(planta.company, (sinCamara.get(planta.company) ?? 0) + 1);
    continue;
  }

  planta.cameraUrl = url;
  conCamara++;
}

console.log(`Con cámara: ${conCamara} de ${plantas.length} plantas\n`);

if (sinCamara.size > 0) {
  console.log('Empresas sin página de cámaras conocida:');
  for (const [empresa, cuantas] of [...sinCamara].sort((a, b) => b[1] - a[1])) {
    console.log(`   ${String(cuantas).padStart(2)} plantas · ${empresa}`);
  }
  console.log();
}

if (!WRITE) {
  console.log('Prueba en seco. Repite con  --write  para guardar.');
  process.exit(0);
}

await writeFile(archivoSemilla, `${JSON.stringify(plantas, null, 2)}\n`, 'utf8');

const db = getFirestore(getApps()[0] ?? initializeApp(credenciales()));
const lote = db.batch();

for (const planta of plantas) {
  lote.set(
    db.collection('plants').doc(planta.id),
    { cameraUrl: planta.cameraUrl ?? null },
    { merge: true },
  );
}

await lote.commit();
console.log(`Guardadas ${conCamara} cámaras en Firestore y en src/data/plants.json.`);
process.exit(0);
