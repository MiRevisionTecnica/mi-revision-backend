/**
 * Sincroniza el catálogo con el listado oficial del MTT, a mano.
 *
 * Uso:  npm run tarifas            (prueba en seco: solo muestra)
 *       npm run tarifas -- --write (escribe en Firestore y en el JSON)
 *
 * El servicio hace lo mismo solo una vez al mes; este comando existe para
 * forzarlo tras editar el catálogo o para revisar qué publicó el Ministerio.
 * La lógica vive en src/plants/tarifas-refresh.ts, compartida con el cron.
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
import {
  refreshTarifas,
  saveTarifas,
  type PlantaCatalogo,
} from '../plants/tarifas-refresh.js';

const WRITE = process.argv.includes('--write');

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

// Se resuelve desde la raíz del proyecto y no desde import.meta.url: el comando
// corre compilado desde dist/, y ahí la ruta relativa apuntaría a la copia del
// build en vez del archivo fuente que sí se versiona.
const archivoSemilla = resolve(process.cwd(), 'src/data/plants.json');
const plantas = JSON.parse(await readFile(archivoSemilla, 'utf8')) as PlantaCatalogo[];

const resultado = await refreshTarifas(plantas);

console.log(`Archivo oficial: ${resultado.archivo}`);
console.log(`Vigencia informada: ${resultado.vigencia}`);
console.log(`Filas de la Región Metropolitana: ${resultado.oficiales}`);
console.log(`Actualizadas: ${resultado.actualizadas} de ${plantas.length}\n`);

const clases: Record<string, number> = {};
for (const planta of plantas) {
  const clave = (planta.classes ?? []).join('') || 'sin clase';
  clases[clave] = (clases[clave] ?? 0) + 1;
}
console.log(`Clases resultantes: ${JSON.stringify(clases)}\n`);

if (resultado.sinFilaOficial.length > 0) {
  console.log('Ya no figuran en el listado oficial (se marcarán como cerradas):');
  for (const planta of resultado.sinFilaOficial) {
    console.log(`   ${planta.id} · ${planta.comuna} · ${planta.address} · ${planta.company}`);
  }
  console.log();
}

if (resultado.faltantes.length > 0) {
  console.log('Plantas oficiales que no están en el catálogo:');
  for (const fila of resultado.faltantes) {
    console.log(
      `   ${fila.codigo} · ${fila.comuna} · ${fila.direccion} · ${fila.empresa}`,
    );
  }
  console.log();
}

if (!WRITE) {
  console.log('Prueba en seco. Repite con  --write  para guardar.');
  process.exit(0);
}

await writeFile(archivoSemilla, `${JSON.stringify(plantas, null, 2)}\n`, 'utf8');
await saveTarifas(getFirestore(getApps()[0] ?? initializeApp(credenciales())), plantas, resultado);

console.log('Firestore y src/data/plants.json actualizados.');
process.exit(0);
