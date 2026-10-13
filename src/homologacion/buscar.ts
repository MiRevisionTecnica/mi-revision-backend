import type { Homologacion } from './nomina.js';

/**
 * Encontrar la homologación de un vehículo en la nómina.
 *
 * El problema es el mismo que tuvimos con la tasación del SII: lo que sabemos
 * del auto --"SUZUKI SWIFT 1.2"-- no se parece a cómo lo escribe el Ministerio
 * --"Swift 1,2 Lts. DOHC Hatchback 5P. T/M Motor Otto"--. Hay que acercarlos sin
 * inventar coincidencias.
 *
 * Nunca devuelve una sola respuesta fingiendo certeza: devuelve las candidatas
 * ordenadas, y la app muestra un selector cuando hay más de una. "Swift" solo
 * son 41 filas, porque cada versión tiene su propio código.
 */

/** Una palabra que no distingue nada y solo ensucia la comparación. */
const RUIDO = new Set([
  'LTS', 'LTS.', 'MOTOR', 'OTTO', 'DIESEL', 'DIÉSEL', 'DOHC', 'SOHC',
  'T/M', 'T/A', 'DE', 'Y', 'CON', '4P', '5P', '2P', '3P',
]);

export type Candidata = Homologacion & { puntaje: number };

export function buscarHomologacion(
  nomina: Homologacion[],
  consulta: { marca: string; modelo: string; anio?: number },
): Candidata[] {
  const marca = normalizar(consulta.marca);
  if (!marca) return [];

  // La marca tiene que calzar; el modelo es lo que se puntúa. Se acepta que una
  // contenga a la otra porque hay marcas escritas de varias formas --"VW" y
  // "Volkswagen", "Mercedes" y "Mercedes Benz"--.
  const deLaMarca = nomina.filter((fila) => {
    const suya = normalizar(fila.marca);
    return suya === marca || suya.includes(marca) || marca.includes(suya);
  });

  if (deLaMarca.length === 0) return [];

  const buscadas = palabrasUtiles(consulta.modelo);
  if (buscadas.length === 0) return deLaMarca.map((fila) => ({ ...fila, puntaje: 0 }));

  const conAlgo = deLaMarca
    .map((fila) => ({ ...fila, puntaje: parecido(fila, buscadas) }))
    // Sin una sola palabra en común no es el mismo modelo, es otra cosa de la
    // misma marca. Mostrarla sería peor que no mostrar nada.
    .filter((fila) => fila.puntaje > 0);

  // La primera palabra es el nombre del modelo --la gente escribe "TIGUAN 1.4",
  // no "1.4 TIGUAN"-- y pesa más que todo lo demás. Sin esto, buscando un
  // Tiguan 1.4 aparecían Polo 1,4 en segundo lugar: calzan por la cilindrada,
  // pero son otro auto. Si nada lleva ese nombre se devuelve el resto, porque
  // puede estar escrito distinto.
  const porNombre = conAlgo.filter((fila) => palabrasUtiles(fila.modelo).includes(buscadas[0]));
  const candidatas = porNombre.length > 0 ? porNombre : conAlgo;

  const alAlcance = consulta.anio ? candidatas.filter((f) => homologadaAntes(f, consulta.anio!)) : candidatas;

  // Si el año deja fuera a todas, se devuelven igual: más vale una fecha rara
  // que una pantalla vacía, y la persona reconoce su versión al verla.
  const finales = alAlcance.length > 0 ? alAlcance : candidatas;

  return finales.sort(
    (a, b) =>
      b.puntaje - a.puntaje ||
      sobrantes(a, buscadas) - sobrantes(b, buscadas) ||
      compararFechas(b, a),
  );
}

/**
 * Cuántas palabras le sobran a la fila respecto de lo que se buscó.
 *
 * Desempata entre filas con el mismo puntaje. Buscando "YARIS", tanto
 * "Yaris SD 1.5 HEV" como "GR Yaris 1.6 Turbo AWD 6MT" tienen una palabra en
 * común, pero el segundo es otro auto --un deportivo-- y se nota en que arrastra
 * mucho más que no se pidió. Menos sobra, más se parece.
 */
function sobrantes(fila: Homologacion, buscadas: string[]): number {
  const pedidas = new Set(buscadas);
  return palabrasUtiles(fila.modelo).filter((palabra) => !pedidas.has(palabra)).length;
}

/**
 * Cuántas palabras del modelo buscado aparecen en el de la nómina.
 *
 * Palabras completas y no trozos: "GL" está contenido en "GLX", y con
 * coincidencias parciales un Swift GL terminaría mostrando el código del GLX.
 */
function parecido(fila: Homologacion, buscadas: string[]): number {
  const suyas = new Set(palabrasUtiles(fila.modelo));
  return buscadas.filter((palabra) => suyas.has(palabra)).length;
}

/**
 * "SWIFT GL 1.2" → ["SWIFT", "GL", "1.2"], sin las palabras que repite toda la
 * nómina. La cilindrada se deja: es de lo que mejor distingue una versión.
 */
function palabrasUtiles(texto: string): string[] {
  return normalizar(texto)
    .split(/\s+/)
    .map((palabra) => palabra.replace(',', '.'))
    .filter((palabra) => palabra.length > 0 && !RUIDO.has(palabra));
}

function normalizar(texto: string): string {
  return (texto ?? '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

/**
 * La fecha de la nómina es cuándo se certificó el modelo, no el año del auto.
 * Un Swift 2024 puede estar homologado desde 2013, así que solo se descartan
 * las homologaciones **posteriores** al vehículo.
 */
function homologadaAntes(fila: Homologacion, anio: number): boolean {
  const suyo = anioDe(fila.fecha);
  return suyo === null || suyo <= anio;
}

function compararFechas(a: Homologacion, b: Homologacion): number {
  return (anioDe(a.fecha) ?? 0) - (anioDe(b.fecha) ?? 0);
}

/** "3-Sep-13" y "24-Apr-14" son los formatos que trae la planilla. */
function anioDe(fecha: string): number | null {
  const dos = /-(\d{2})$/.exec(fecha ?? '');
  if (dos) return 2000 + Number(dos[1]);

  const cuatro = /(\d{4})/.exec(fecha ?? '');
  return cuatro ? Number(cuatro[1]) : null;
}
