import { Injectable, Logger } from '@nestjs/common';
import { buscarHomologacion, type Candidata } from './buscar.js';
import { descargarNomina, leerNomina, type Homologacion } from './nomina.js';

/**
 * La homologación de un vehículo, según el Ministerio.
 *
 * La nómina es una planilla de 16 MB con casi catorce mil modelos. Se descarga
 * y se lee **una vez al día**, en memoria: bajarla en cada consulta sería
 * absurdo, y guardarla en disco no sirve porque el servidor se reinicia con
 * cada despliegue y el disco se va con él.
 *
 * La carga es perezosa, no al arrancar: si el sitio del Ministerio está caído
 * --y se cae-- el servidor tiene que seguir atendiendo vencimientos, que es lo
 * que la gente necesita de verdad.
 */

const UN_DIA = 24 * 60 * 60 * 1000;

@Injectable()
export class HomologacionService {
  private readonly logger = new Logger(HomologacionService.name);

  private nomina: Homologacion[] = [];
  private cargadaEn = 0;
  /** La descarga en curso, para que diez consultas a la vez no bajen diez veces. */
  private cargando: Promise<Homologacion[]> | null = null;

  async buscar(consulta: { marca: string; modelo: string; anio?: number }): Promise<Candidata[]> {
    const nomina = await this.obtener();
    return buscarHomologacion(nomina, consulta);
  }

  /** Para el chequeo de salud: si la nómina está cargada y de cuándo es. */
  estado(): { modelos: number; cargadaEn: string | null } {
    return {
      modelos: this.nomina.length,
      cargadaEn: this.cargadaEn ? new Date(this.cargadaEn).toISOString() : null,
    };
  }

  private async obtener(): Promise<Homologacion[]> {
    const vigente = Date.now() - this.cargadaEn < UN_DIA;
    if (this.nomina.length > 0 && vigente) return this.nomina;

    this.cargando ??= this.cargar();

    try {
      return await this.cargando;
    } finally {
      this.cargando = null;
    }
  }

  private async cargar(): Promise<Homologacion[]> {
    try {
      const archivo = await descargarNomina();
      const filas = leerNomina(archivo);

      if (filas.length === 0) throw new Error('La nómina vino vacía.');

      this.nomina = filas;
      this.cargadaEn = Date.now();
      this.logger.log(`Nómina de homologación cargada: ${filas.length} modelos.`);

      return filas;
    } catch (error) {
      // Con una copia vieja en memoria se sigue respondiendo: un dato de hace
      // una semana es infinitamente mejor que un error, porque la homologación
      // de un modelo no cambia nunca una vez otorgada.
      this.logger.warn(`No pude actualizar la nómina: ${(error as Error).message}`);

      if (this.nomina.length > 0) return this.nomina;
      throw error;
    }
  }
}
