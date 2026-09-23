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

  /** Las tasaciones que calzan con una marca, un modelo y un año. */
  async porModelo(marca: string, modelo: string, anioFabricacion: string): Promise<Tasacion[]> {
    const marcaSii = await this.marca(marca);
    if (!marcaSii) return [];

    return this.buscar({
      extra: [marcaSii],
      modelVehicle: modelo.toUpperCase(),
      versionVehicle: '',
      anio: anioFabricacion,
      anioAfabCase: true,
    });
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

  private async marca(nombre: string): Promise<Record<string, unknown> | null> {
    const respuesta = await this.llamar('getMarksByCategory', 1);
    const buscado = nombre.trim().toUpperCase();

    return (
      filasDe(respuesta).find((fila) => String(fila.marca ?? '').toUpperCase() === buscado) ?? null
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
