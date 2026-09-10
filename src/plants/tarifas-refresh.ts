/**
 * Sincroniza el catálogo con el listado oficial del Ministerio de Transportes.
 *
 * De ahí salen tres cosas que no podemos inventar ni mantener a mano:
 *
 *  - **El valor de la revisión.** No hay precio único: el MTT fija un tope y
 *    cada concesionaria cobra dentro de ese rango, así que el dato es por planta.
 *  - **La clase de la planta**, que dice qué vehículos atiende. Va en el código
 *    oficial (A-1303, B-1353, AB1307) y lo confirman las tarifas: una planta
 *    clase A no tiene tarifa de autos porque no los atiende.
 *  - **Qué plantas siguen operando.** Las que dejan de aparecer se marcan como
 *    cerradas, y así dejan de listarse sin que nadie tenga que darse cuenta.
 *
 * El archivo se publica con el mes en el nombre. El de nombre estable
 * (TarifasyHorariosPRT.xlsx) quedó congelado en 2020, así que se busca el más
 * reciente en la página del buscador en vez de fijar una URL.
 */
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { get } from 'node:https';
import { rootCertificates } from 'node:tls';
import * as XLSX from 'xlsx';
import type { Firestore } from 'firebase-admin/firestore';
import type { PlantPrice } from '../firebase/collections.js';

const BUSCADOR = 'https://www.prt.cl/Paginas/Buscador.aspx';

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

export type FilaOficial = {
  /** Código de la planta: la letra inicial es su clase. */
  codigo: string;
  clases: string[];
  comuna: string;
  empresa: string;
  direccion: string;
  precios: PlantPrice[];
};

export type PlantaCatalogo = {
  id: string;
  company: string;
  comuna: string;
  address: string;
  classes?: string[];
  prices?: PlantPrice[] | null;
  pricesUpdatedAt?: string | null;
  officialCode?: string | null;
  status?: string;
  [clave: string]: unknown;
};

export type ResultadoTarifas = {
  archivo: string;
  vigencia: string;
  oficiales: number;
  actualizadas: number;
  sinFilaOficial: PlantaCatalogo[];
  faltantes: FilaOficial[];
};

/**
 * Descarga un archivo de prt.cl.
 *
 * Va por node:https y no por fetch porque hay que entregarle el certificado
 * intermedio que ese servidor no manda en su cadena. Se agrega a los de
 * confianza en vez de desactivar la verificación: el problema es una cadena
 * incompleta, no un certificado inválido, y apagar la comprobación entera para
 * arreglar eso abriría la puerta a cualquier otra cosa.
 */
async function descargar(url: string): Promise<Buffer> {
  const aqui = dirname(fileURLToPath(import.meta.url));
  const cadena = await readFile(resolve(aqui, 'certs/prt-cadena.pem'), 'utf8');

  // Los certificados propios se SUMAN a los de fábrica: pasar solo los nuestros
  // los reemplazaría, y entonces fallaría cualquier otra descarga.
  return new Promise((cumplir, fallar) => {
    const peticion = get(url, { ca: [...rootCertificates, cadena] }, (respuesta) => {
      if (respuesta.statusCode !== 200) {
        respuesta.resume();
        fallar(new Error(`${url} respondió ${respuesta.statusCode}`));
        return;
      }

      const trozos: Buffer[] = [];
      respuesta.on('data', (trozo: Buffer) => trozos.push(trozo));
      respuesta.on('end', () => cumplir(Buffer.concat(trozos)));
    });

    peticion.on('error', fallar);
    peticion.setTimeout(30_000, () => {
      peticion.destroy(new Error(`${url} no respondió en 30 segundos`));
    });
  });
}

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

function palabras(direccion: unknown): string[] {
  return normalizar(direccion)
    .split(' ')
    .map((palabra) => ABREVIATURAS[palabra] ?? palabra)
    .filter((palabra) => palabra.length > 2 && !/^\d+$/.test(palabra));
}

/** La clase sale del prefijo del código oficial: A-1303, B-1353, AB1307. */
function clasesDe(codigo: string): string[] {
  const limpio = normalizar(codigo);
  if (limpio.startsWith('AB')) return ['A', 'B'];
  if (limpio.startsWith('A')) return ['A'];
  if (limpio.startsWith('B')) return ['B'];
  return [];
}

async function ultimoArchivo(): Promise<{ url: string; vigencia: string }> {
  const html = (await descargar(BUSCADOR)).toString('utf8');
  const encontrados = [
    ...html.matchAll(/Documentos\/(Tarifas_y_Horarios_([A-Za-zÀ-ſ]+)_(\d{4})\.xlsx)/g),
  ];

  if (encontrados.length === 0) {
    throw new Error(
      'No se encontró ningún archivo de tarifas en prt.cl. Puede que hayan cambiado la página.',
    );
  }

  const elegido = encontrados
    .map((coincidencia) => ({
      url: `https://www.prt.cl/Documentos/${coincidencia[1]}`,
      anio: Number(coincidencia[3]),
      mes: MESES.indexOf(normalizar(coincidencia[2]).toLowerCase()),
    }))
    .sort((a, b) => b.anio - a.anio || b.mes - a.mes)[0];

  // El archivo informa el mes, no el día; en pantalla solo se muestra "mes de año".
  return {
    url: elegido.url,
    vigencia: `${elegido.anio}-${String(elegido.mes + 1).padStart(2, '0')}-01`,
  };
}

function leerFilas(buffer: Buffer): FilaOficial[] {
  const libro = XLSX.read(buffer, { type: 'buffer' });
  const filas = XLSX.utils.sheet_to_json<unknown[]>(libro.Sheets[libro.SheetNames[0]], {
    header: 1,
    defval: '',
  });

  // Las celdas sin tarifa traen "----" en vez de quedar vacías.
  const monto = (valor: unknown): number | null => {
    const numero = Number(valor);
    return Number.isFinite(numero) && numero > 0 ? numero : null;
  };

  return filas
    .filter((fila) => normalizar(fila[4]).includes('METROPOLITANA'))
    .map((fila) => {
      const codigo = String(fila[3]).trim();
      const precios: PlantPrice[] = [];
      const autos = monto(fila[10]);
      const camiones = monto(fila[11]);
      const taxis = monto(fila[12]);

      if (autos) precios.push({ label: 'Autos y camionetas', amount: autos });
      if (camiones) precios.push({ label: 'Camiones y buses', amount: camiones });
      if (taxis) precios.push({ label: 'Taxis', amount: taxis });

      return {
        codigo,
        clases: clasesDe(codigo),
        comuna: normalizar(fila[5]),
        empresa: String(fila[6]).trim(),
        direccion: String(fila[7]).trim(),
        precios,
      };
    })
    .filter((fila) => fila.codigo.length > 0);
}

/**
 * Empareja una planta del catálogo con su fila oficial.
 *
 * Primero por el número de la dirección, que es lo que menos se presta a
 * confusión; si no calza, por el nombre de la calle. No se adivina más allá de
 * eso a propósito: un precio o una clase equivocados son peores que no mostrar
 * nada, porque mandan a la persona a la planta que no corresponde.
 */
export function emparejar(
  planta: PlantaCatalogo,
  disponibles: FilaOficial[],
): FilaOficial | null {
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

/** Descarga el listado vigente y lo cruza con el catálogo que se le entrega. */
export async function refreshTarifas(
  plantas: PlantaCatalogo[],
): Promise<ResultadoTarifas> {
  const { url, vigencia } = await ultimoArchivo();
  const oficiales = leerFilas(await descargar(url));

  const usadas = new Set<string>();
  const sinFilaOficial: PlantaCatalogo[] = [];
  let actualizadas = 0;

  for (const planta of plantas) {
    const fila = emparejar(
      planta,
      oficiales.filter((oficial) => !usadas.has(oficial.codigo)),
    );

    if (!fila) {
      sinFilaOficial.push(planta);
      continue;
    }

    usadas.add(fila.codigo);
    planta.officialCode = fila.codigo;
    planta.pricesUpdatedAt = vigencia;
    if (fila.precios.length > 0) planta.prices = fila.precios;
    if (fila.clases.length > 0) planta.classes = fila.clases;
    actualizadas++;
  }

  return {
    archivo: url,
    vigencia,
    oficiales: oficiales.length,
    actualizadas,
    sinFilaOficial,
    faltantes: oficiales.filter((oficial) => !usadas.has(oficial.codigo)),
  };
}

/**
 * Guarda en Firestore lo que salió del cruce.
 *
 * Las plantas que dejaron de aparecer en el listado se marcan como cerradas, no
 * se borran: si vuelven, o si el archivo del MTT tenía un hueco, el dato sigue
 * ahí para revisarlo. La API ya filtra las cerradas.
 */
export async function saveTarifas(
  db: Firestore,
  plantas: PlantaCatalogo[],
  resultado: ResultadoTarifas,
): Promise<void> {
  const cerradas = new Set(resultado.sinFilaOficial.map((planta) => planta.id));
  const lote = db.batch();

  for (const planta of plantas) {
    const referencia = db.collection('plants').doc(planta.id);

    if (cerradas.has(planta.id)) {
      lote.set(
        referencia,
        { status: 'closed', closedReason: 'No figura en el listado del MTT' },
        { merge: true },
      );
      continue;
    }

    lote.set(
      referencia,
      {
        prices: planta.prices ?? null,
        pricesUpdatedAt: planta.pricesUpdatedAt ?? null,
        classes: planta.classes ?? [],
        officialCode: planta.officialCode ?? null,
        status: 'operational',
      },
      { merge: true },
    );
  }

  await lote.commit();
}
