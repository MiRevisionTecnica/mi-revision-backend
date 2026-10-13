import * as XLSX from 'xlsx';

/**
 * La nómina oficial de vehículos homologados.
 *
 * La publica el 3CV del Ministerio de Transportes en una planilla que se
 * actualiza cada pocas semanas. Es **la** fuente: un modelo recién homologado
 * aparece ahí antes que en ningún otro lado, porque ahí es donde se publica.
 *
 * La homologación es del modelo, no del auto. No existe --ni va a existir-- una
 * consulta por patente: el certificado se le otorga a una versión completa, y
 * todos los autos iguales comparten el mismo código.
 */

/** La página desde donde se lee el enlace al archivo del mes. */
const PAGINA = 'https://www.subtrans.gob.cl/3cv/homologacion-de-vehiculos-livianos-medianos-y-motocicletas/';

/** La planilla cambia de nombre cada vez --lleva la fecha-- así que se busca. */
const ENLACE = /href="([^"]*Nomina-Vehiculos-Livianos[^"]*\.xls)"/i;

export type Homologacion = {
  marca: string;
  modelo: string;
  transmision: string;
  combustible: string;
  cilindrada: string;
  carroceria: string;
  /** El que viene impreso en el padrón y en el permiso de circulación. */
  codigo: string;
  certificado: string;
  /** Cuándo se homologó el modelo, no el año del vehículo. */
  fecha: string;
  norma: string;
};

/** Los encabezados que nos interesan, tal como los escribe el Ministerio. */
const COLUMNAS = {
  marca: 'Marca',
  modelo: 'Modelo',
  transmision: 'Transmisión',
  combustible: 'Combustible',
  cilindrada: 'Cilindrada (Lts.)',
  carroceria: 'Tipo de Carroceria',
  codigo: 'Código de Informe Técnico',
  certificado: 'N° Cert.',
  fecha: 'Fecha de Homologación',
  norma: 'Norma Europea',
} as const;

export async function descargarNomina(): Promise<Buffer> {
  const pagina = await fetch(PAGINA, { headers: { 'user-agent': 'Mozilla/5.0' } });
  if (!pagina.ok) throw new Error(`La página del 3CV respondió ${pagina.status}`);

  const enlace = ENLACE.exec(await pagina.text())?.[1];
  if (!enlace) throw new Error('No encontré el enlace a la nómina en la página del 3CV.');

  const archivo = await fetch(enlace, { headers: { 'user-agent': 'Mozilla/5.0' } });
  if (!archivo.ok) throw new Error(`La nómina respondió ${archivo.status}`);

  return Buffer.from(await archivo.arrayBuffer());
}

/**
 * Convierte la planilla en filas.
 *
 * Las cuatro hojas --una por época-- **no tienen las mismas columnas**: el
 * código está en la novena en la hoja nueva y en la octava en las otras tres.
 * Por eso se leen los encabezados de cada hoja en vez de usar posiciones fijas:
 * con un índice a mano se importaría basura sin que nadie lo note.
 */
export function leerNomina(archivo: Buffer): Homologacion[] {
  const libro = XLSX.read(archivo, { type: 'buffer' });
  const filas: Homologacion[] = [];

  for (const nombre of libro.SheetNames) {
    const hoja = XLSX.utils.sheet_to_json<unknown[]>(libro.Sheets[nombre], {
      header: 1,
      raw: false,
    });

    const encabezado = hoja.find((fila) => fila.includes(COLUMNAS.marca));
    if (!encabezado) continue;

    const donde = (titulo: string) => encabezado.indexOf(titulo);
    const col = {
      marca: donde(COLUMNAS.marca),
      modelo: donde(COLUMNAS.modelo),
      transmision: donde(COLUMNAS.transmision),
      combustible: donde(COLUMNAS.combustible),
      cilindrada: donde(COLUMNAS.cilindrada),
      carroceria: donde(COLUMNAS.carroceria),
      codigo: donde(COLUMNAS.codigo),
      certificado: donde(COLUMNAS.certificado),
      fecha: donde(COLUMNAS.fecha),
      norma: donde(COLUMNAS.norma),
    };

    if (col.marca < 0 || col.modelo < 0) continue;

    for (const fila of hoja) {
      const marca = texto(fila[col.marca]);
      const modelo = texto(fila[col.modelo]);
      if (!marca || !modelo || marca === COLUMNAS.marca) continue;

      filas.push({
        marca,
        modelo,
        transmision: texto(fila[col.transmision]),
        combustible: texto(fila[col.combustible]),
        cilindrada: texto(fila[col.cilindrada]),
        carroceria: texto(fila[col.carroceria]),
        codigo: texto(fila[col.codigo]),
        certificado: texto(fila[col.certificado]),
        fecha: texto(fila[col.fecha]),
        norma: texto(fila[col.norma]),
      });
    }
  }

  return filas;
}

function texto(valor: unknown): string {
  return valor === undefined || valor === null ? '' : String(valor).trim();
}
