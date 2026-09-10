/**
 * Importa los valores oficiales de la revisión técnica.
 *
 * Uso:  npm run tarifas            (prueba en seco: solo muestra)
 *       npm run tarifas -- --write (escribe en Firestore y en el JSON)
 *
 * La fuente es el listado que publica el Ministerio de Transportes en prt.cl,
 * con la tarifa planta por planta. No hay un precio único nacional: el MTT fija
 * un tope y cada concesionaria cobra dentro de ese rango, así que el dato tiene
 * que salir de cada planta o no sirve.
 *
 * El archivo se publica cada cierto tiempo con el mes en el nombre. El de nombre
 * fijo (TarifasyHorariosPRT.xlsx) quedó congelado en 2020, así que se busca el
 * más reciente en la página del buscador en lugar de escribir una URL a mano.
 *
 * Necesita `--use-system-ca`: el servidor de prt.cl no entrega el certificado
 * intermedio, y la raíz que le falta a Node sí está en el almacén del sistema.
 * Se resuelve así y no desactivando la verificación del certificado.
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
import * as XLSX from 'xlsx';
import type { PlantPrice } from '../firebase/collections.js';

const BUSCADOR = 'https://www.prt.cl/Paginas/Buscador.aspx';
const WRITE = process.argv.includes('--write');

const MESES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

type FilaOficial = {
  codigo: string;
  comuna: string;
  empresa: string;
  direccion: string;
  precios: PlantPrice[];
};

type PlantaLocal = {
  id: string;
  company: string;
  comuna: string;
  address: string;
  prices?: PlantPrice[] | null;
  pricesUpdatedAt?: string | null;
  [clave: string]: unknown;
};

/** Mayúsculas, sin tildes y sin puntuación, para poder comparar textos. */
function normalizar(texto: unknown): string {
  return String(texto)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Los números de una dirección, sin ceros a la izquierda: "Nº02891" da "2891". */
function numeros(direccion: unknown): string[] {
  return (String(direccion).match(/\d{1,6}/g) ?? []).map((n) => String(Number(n)));
}

const ABREVIATURAS: Record<string, string> = {
  STA: 'SANTA',
  STO: 'SANTO',
  AV: '',
  AVDA: '',
  AVENIDA: '',
  CALLE: '',
  N: '',
};

/** Palabras significativas de una calle, con las abreviaturas comunes resueltas. */
function palabras(direccion: unknown): string[] {
  return normalizar(direccion)
    .split(' ')
    .map((palabra) => ABREVIATURAS[palabra] ?? palabra)
    .filter((palabra) => palabra.length > 2 && !/^\d+$/.test(palabra));
}

/** Ubica el archivo más reciente publicado, en vez de fijar una URL. */
async function ultimoArchivo(): Promise<{ url: string; mes: string }> {
  const html = await (await fetch(BUSCADOR)).text();
  const encontrados = [
    ...html.matchAll(/Documentos\/(Tarifas_y_Horarios_([A-Za-zÀ-ſ]+)_(\d{4})\.xlsx)/g),
  ];

  if (encontrados.length === 0) {
    throw new Error(
      'No se encontró ningún archivo de tarifas en prt.cl. Puede que hayan cambiado la página.',
    );
  }

  const ordenados = encontrados
    .map((coincidencia) => ({
      url: `https://www.prt.cl/Documentos/${coincidencia[1]}`,
      anio: Number(coincidencia[3]),
      mes: MESES.indexOf(normalizar(coincidencia[2]).toLowerCase()),
    }))
    .sort((a, b) => b.anio - a.anio || b.mes - a.mes);

  const elegido = ordenados[0];

  // Se guarda el primer día del mes publicado: el archivo informa el mes y no el
  // día, y en pantalla solo se muestra "mes de año".
  const mes = `${elegido.anio}-${String(elegido.mes + 1).padStart(2, '0')}-01`;

  return { url: elegido.url, mes };
}

function leerFilas(buffer: ArrayBuffer): FilaOficial[] {
  const libro = XLSX.read(new Uint8Array(buffer), { type: 'array' });
  const hoja = libro.Sheets[libro.SheetNames[0]];
  const filas = XLSX.utils.sheet_to_json<unknown[]>(hoja, { header: 1, defval: '' });

  // Las celdas sin tarifa traen "----" en vez de quedar vacías.
  const monto = (valor: unknown): number | null => {
    const numero = Number(valor);
    return Number.isFinite(numero) && numero > 0 ? numero : null;
  };

  return filas
    .filter((fila) => normalizar(fila[4]).includes('METROPOLITANA'))
    .map((fila) => {
      const precios: PlantPrice[] = [];
      const autos = monto(fila[10]);
      const camiones = monto(fila[11]);
      const taxis = monto(fila[12]);

      if (autos) precios.push({ label: 'Autos y camionetas', amount: autos });
      if (camiones) precios.push({ label: 'Camiones y buses', amount: camiones });
      if (taxis) precios.push({ label: 'Taxis', amount: taxis });

      return {
        codigo: String(fila[3]).trim(),
        comuna: normalizar(fila[5]),
        empresa: String(fila[6]).trim(),
        direccion: String(fila[7]).trim(),
        precios,
      };
    })
    .filter((fila) => fila.codigo.length > 0);
}

/**
 * Empareja una planta nuestra con su fila oficial.
 *
 * Primero por el número de la dirección, que es lo que menos se presta a
 * confusión; si no calza, por el nombre de la calle. No se adivina más allá de
 * eso a propósito: un precio equivocado es peor que no mostrar ninguno.
 */
function emparejar(planta: PlantaLocal, disponibles: FilaOficial[]): FilaOficial | null {
  const candidatas = disponibles.filter((fila) => fila.comuna === normalizar(planta.comuna));
  if (candidatas.length === 0) return null;

  const misNumeros = numeros(planta.address);
  const porNumero = candidatas.find((fila) =>
    numeros(fila.direccion).some((numero) => misNumeros.includes(numero)),
  );
  if (porNumero) return porNumero;

  const misPalabras = palabras(planta.address);
  const puntuadas = candidatas
    .map((fila) => ({
      fila,
      puntaje: palabras(fila.direccion).filter((palabra) => misPalabras.includes(palabra)).length,
    }))
    .sort((a, b) => b.puntaje - a.puntaje);

  if ((puntuadas[0]?.puntaje ?? 0) >= 1) return puntuadas[0].fila;

  return candidatas.length === 1 ? candidatas[0] : null;
}

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

// ---------------------------------------------------------------------------

const { url, mes } = await ultimoArchivo();
console.log(`Archivo oficial: ${url}`);
console.log(`Vigencia informada: ${mes}\n`);

const oficiales = leerFilas(await (await fetch(url)).arrayBuffer());
console.log(`Filas de la Región Metropolitana: ${oficiales.length}`);

const archivoSemilla = resolve(process.cwd(), 'src/data/plants.json');
const plantas = JSON.parse(await readFile(archivoSemilla, 'utf8')) as PlantaLocal[];

const usadas = new Set<string>();
const sinPrecio: PlantaLocal[] = [];
let conPrecio = 0;

for (const planta of plantas) {
  const fila = emparejar(
    planta,
    oficiales.filter((oficial) => !usadas.has(oficial.codigo)),
  );

  if (!fila || fila.precios.length === 0) {
    sinPrecio.push(planta);
    continue;
  }

  usadas.add(fila.codigo);
  planta.prices = fila.precios;
  planta.pricesUpdatedAt = mes;
  conPrecio++;
}

console.log(`Con valor oficial: ${conPrecio} de ${plantas.length}\n`);

if (sinPrecio.length > 0) {
  console.log('Sin fila en el listado oficial (conviene revisar si siguen operando):');
  for (const planta of sinPrecio) {
    console.log(`   ${planta.id} · ${planta.comuna} · ${planta.address} · ${planta.company}`);
  }
  console.log();
}

const noUsadas = oficiales.filter((oficial) => !usadas.has(oficial.codigo));
if (noUsadas.length > 0) {
  console.log('Plantas oficiales que no están en nuestro catálogo:');
  for (const oficial of noUsadas) {
    console.log(`   ${oficial.codigo} · ${oficial.comuna} · ${oficial.direccion} · ${oficial.empresa}`);
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
  if (!planta.prices) continue;
  lote.set(
    db.collection('plants').doc(planta.id),
    { prices: planta.prices, pricesUpdatedAt: planta.pricesUpdatedAt },
    { merge: true },
  );
}

await lote.commit();
console.log(`Guardados ${conPrecio} valores en Firestore y en src/data/plants.json.`);
process.exit(0);
