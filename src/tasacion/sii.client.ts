import { Injectable, Logger } from '@nestjs/common';

/**
 * Consulta la tasación fiscal de vehículos al SII.
 *
 * El SII publica cada enero la nómina completa --más de ochenta mil vehículos
 * livianos-- y la expone detrás de su buscador público. En vez de copiar esa
 * nómina, que habría que actualizar todos los años, se le pregunta a él: así la
 * app muestra la tasación del año vigente desde el día en que el SII la publica.
 *
 * La consulta devuelve dos cosas que la gente quiere saber: cuánto vale el
 * vehículo para el SII y **cuánto se va a pagar de permiso de circulación**, que
 * es lo que de verdad importa en marzo.
 *
 * Es un servicio suyo, no una API documentada para terceros: puede cambiar sin
 * aviso. Por eso cada respuesta se guarda en caché --la tasación cambia una vez
 * al año-- y un fallo nunca rompe la pantalla: simplemente no se muestra el dato.
 */

const BASE = 'https://www4.sii.cl/vehiculospubui/services/data/publicfacadeservice';
const NS = 'cl.sii.sdi.lob.bbrr.vehiculospub.data.api.interfaces.PublicFacadeService';

const TIMEOUT_MS = 12_000;

/** La tasación cambia una vez al año: media hora de caché es conservador. */
const CACHE_MS = 12 * 60 * 60 * 1000;

export type Tasacion = {
  /** Código del SII, el mismo que imprime el permiso de circulación. */
  codigo: string;
  marca: string;
  modelo: string;
  version: string;
  /** Año de fabricación del vehículo. */
  anio: string;
  /** Año de la tasación, que es el que el SII tiene vigente. */
  anioTasacion: string;
  /** Tasación fiscal en pesos. */
  tasacion: number;
  /** Lo que costaría el permiso de circulación, en pesos. */
  permiso: number;
};

type Guardado = { valor: unknown; at: number };

@Injectable()
export class SiiClient {
  private readonly logger = new Logger(SiiClient.name);
  private readonly cache = new Map<string, Guardado>();

  /** La tasación de un vehículo por su código del SII. */
  async porCodigo(codigo: string, anioFabricacion: string): Promise<Tasacion | null> {
    // El permiso imprime el código con dígitos de más al final; el buscador usa
    // los primeros nueve, que son los que identifican al modelo y su versión.
    const limpio = codigo.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 9);
    if (limpio.length < 9) return null;

    const filas = await this.buscar({ code: limpio, anio: anioFabricacion, anioAfabCase: true });
    return filas[0] ?? null;
  }

  /**
   * Las tasaciones que calzan con una marca, un modelo y un año.
   *
   * El SII busca por el modelo pelado --"SWIFT"-- y la gente lo tiene escrito
   * con su versión, como lo trae el padrón: "SWIFT GL 1.2". Buscar eso tal cual
   * devuelve cero, así que se va soltando la última palabra hasta que algo
   * calce. "SWIFT GL 1.2" → "SWIFT GL" → "SWIFT".
   */
  async porModelo(marca: string, modelo: string, anioFabricacion: string): Promise<Tasacion[]> {
    const marcaSii = await this.marca(marca);
    if (!marcaSii) return [];

    for (const intento of variantesDe(modelo)) {
      const filas = await this.buscar({
        extra: [marcaSii],
        modelVehicle: intento,
        versionVehicle: '',
        anio: anioFabricacion,
        anioAfabCase: true,
      });

      if (filas.length > 0) return ordenarPorParecido(filas, modelo);
    }

    return [];
  }

  /** Las marcas que el SII reconoce, para ofrecerlas en una lista. */
  async marcas(): Promise<string[]> {
    const guardadas = this.recordar<string[]>('marcas');
    if (guardadas) return guardadas;

    const respuesta = await this.llamar('getMarksByCategory', 1);
    const marcas = filasDe(respuesta)
      .map((fila) => String(fila.marca ?? ''))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, 'es'));

    this.guardar('marcas', marcas);
    return marcas;
  }

  /**
   * La marca tal como la escribe el SII.
   *
   * Se acepta que no calce letra por letra: alguien escribe "Mercedes" y el
   * catálogo dice "MERCEDES BENZ". Primero se busca igual, después por comienzo
   * y al final por contenido, que es el orden de menos a más riesgo de
   * confundir una marca con otra.
   */
  private async marca(nombre: string): Promise<Record<string, unknown> | null> {
    const respuesta = await this.llamar('getMarksByCategory', 1);
    const buscado = nombre.trim().toUpperCase();
    if (!buscado) return null;

    const marcas = filasDe(respuesta);
    const nombreDe = (fila: Record<string, unknown>) => String(fila.marca ?? '').toUpperCase();

    return (
      marcas.find((fila) => nombreDe(fila) === buscado) ??
      marcas.find((fila) => nombreDe(fila).startsWith(buscado)) ??
      marcas.find((fila) => nombreDe(fila).includes(buscado)) ??
      null
    );
  }

  /**
   * La búsqueda, en los dos pasos que hace su propia página: primero cuenta y
   * después pide. Pedir sin contar antes devuelve vacío.
   */
  private async buscar(criterio: {
    code?: string;
    extra?: Record<string, unknown>[];
    modelVehicle?: string;
    versionVehicle?: string;
    anio: string;
    anioAfabCase: boolean;
  }): Promise<Tasacion[]> {
    const clave = JSON.stringify(criterio);
    const guardada = this.recordar<Tasacion[]>(clave);
    if (guardada) return guardada;

    try {
      const anios = await this.llamar('getAppraisalYear', []);
      const anio = filasDe(anios)[0];
      if (!anio) return [];

      const consulta = {
        recordsNumber: 10,
        name: null,
        listas: {
          staticList: [anio, { typeClass: 'year', year: anio.year }, ...(criterio.extra ?? [])],
          features: [],
        },
        filter: { campo: null, order: true },
        code: criterio.code ?? '',
        modelVehicle: criterio.modelVehicle ?? '',
        versionVehicle: criterio.versionVehicle ?? '',
        anio: criterio.anio,
        anioAfabCase: criterio.anioAfabCase,
      };

      const cuenta = await this.llamar('countAppraisalSearch', consulta);
      const total = (cuenta?.data as { count?: number } | undefined)?.count ?? 0;
      if (total === 0) {
        this.guardar(clave, []);
        return [];
      }

      const busqueda = await this.llamar('getAppraisalSearch', {
        ...consulta,
        page: 1,
        rowCount: total,
      });

      const tasaciones = filasDe(busqueda)
        .map((fila) => aTasacion(fila))
        .filter((fila): fila is Tasacion => fila !== null);

      this.guardar(clave, tasaciones);
      return tasaciones;
    } catch (error) {
      this.logger.warn(
        `El SII no respondió: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  private recordar<T>(clave: string): T | null {
    const guardado = this.cache.get(clave);
    if (!guardado || Date.now() - guardado.at > CACHE_MS) return null;
    return guardado.valor as T;
  }

  private guardar(clave: string, valor: unknown): void {
    // Tope simple: la consulta es por modelo y año, así que no crece tanto.
    if (this.cache.size > 2000) this.cache.clear();
    this.cache.set(clave, { valor, at: Date.now() });
  }

  private async llamar(metodo: string, datos?: unknown): Promise<{ data?: unknown } | null> {
    const cuerpo: Record<string, unknown> = {
      metaData: {
        namespace: `${NS}/${metodo}`,
        conversationId: '1',
        transactionId: '1',
        page: null,
      },
    };
    if (datos !== undefined) cuerpo.data = datos;

    const control = new AbortController();
    const espera = setTimeout(() => control.abort(), TIMEOUT_MS);

    try {
      const respuesta = await fetch(`${BASE}/${metodo}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://www4.sii.cl',
          Referer: 'https://www4.sii.cl/vehiculospubui/',
        },
        body: JSON.stringify(cuerpo),
        signal: control.signal,
      });

      if (!respuesta.ok) throw new Error(`respondió ${respuesta.status}`);
      return (await respuesta.json()) as { data?: unknown };
    } finally {
      clearTimeout(espera);
    }
  }
}

/**
 * Deja primero la versión que más se parece a lo que la persona tiene escrito.
 *
 * El SII devuelve todas las versiones del modelo y entre ellas la tasación
 * cambia millones: un "SAIL LT 1.5" no vale lo mismo que un "SAIL LS". Sin esto
 * se mostraría la primera que llegue, que es tan arbitraria como cualquiera.
 */
function ordenarPorParecido(filas: Tasacion[], modelo: string): Tasacion[] {
  // Palabras completas y no trozos: "GL" está contenido en "GLX", y con
  // coincidencias parciales un Swift GL terminaba mostrando el precio del GLX.
  const buscadas = modelo.toUpperCase().split(/\s+/).filter(Boolean);

  const parecido = (fila: Tasacion) => {
    const palabras = new Set(`${fila.modelo} ${fila.version}`.toUpperCase().split(/\s+/));
    return buscadas.filter((palabra) => palabras.has(palabra)).length;
  };

  return [...filas].sort((a, b) => parecido(b) - parecido(a));
}

/**
 * "SWIFT GL 1.2" → ["SWIFT GL 1.2", "SWIFT GL", "SWIFT"].
 *
 * De lo más específico a lo más general: si el nombre completo calza, esa es la
 * mejor respuesta; si no, se prueba con menos.
 */
function variantesDe(modelo: string): string[] {
  const palabras = modelo.trim().toUpperCase().split(/\s+/).filter(Boolean);
  const variantes: string[] = [];

  for (let corte = palabras.length; corte > 0; corte--) {
    variantes.push(palabras.slice(0, corte).join(' '));
  }

  return variantes;
}

/** Las respuestas del SII vienen de dos formas según el servicio. */
function filasDe(respuesta: { data?: unknown } | null): Record<string, unknown>[] {
  const data = respuesta?.data as
    | { listResult?: unknown }
    | Record<string, unknown>[]
    | undefined;

  if (Array.isArray(data)) return data as Record<string, unknown>[];

  const lista = (data as { listResult?: unknown } | undefined)?.listResult;
  if (Array.isArray(lista)) return lista as Record<string, unknown>[];

  const anidada = (lista as { appraisalSearchBO?: unknown } | undefined)?.appraisalSearchBO;
  return Array.isArray(anidada) ? (anidada as Record<string, unknown>[]) : [];
}

function aTasacion(fila: Record<string, unknown>): Tasacion | null {
  const tasacion = Number(fila.montoTasa ?? 0);
  if (!Number.isFinite(tasacion) || tasacion <= 0) return null;

  return {
    codigo: String(fila.code ?? ''),
    marca: String(fila.marca ?? ''),
    modelo: String(fila.model ?? ''),
    version: String(fila.version ?? ''),
    anio: String(fila.anio ?? ''),
    anioTasacion: String(fila.anioTasa ?? ''),
    tasacion,
    permiso: Number(fila.montoPerm ?? 0),
  };
}
