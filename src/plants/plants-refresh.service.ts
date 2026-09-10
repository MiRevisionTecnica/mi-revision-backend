import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { COLLECTIONS, type PlantDoc } from '../firebase/collections.js';
import { FirebaseService } from '../firebase/firebase.service.js';
import { refreshFromPlaces, saveToFirestore, type PlantSeed, type RefreshResult } from './places-refresh.js';
import { refreshTarifas, saveTarifas, type PlantaCatalogo } from './tarifas-refresh.js';
import { PlantsService } from './plants.service.js';

/**
 * Mantiene al día el catálogo de plantas contra Google Places.
 *
 * Corre **una vez al mes** (día 1 a las 03:00 de Chile) porque los horarios y
 * los teléfonos casi no cambian, y así el gasto de API queda en 38 llamadas
 * mensuales — dentro del free tier con muchísimo margen. Refrescarlo más seguido
 * no aportaría datos nuevos y sí acercaría la cuenta al cobro.
 */
@Injectable()
export class PlantsRefreshService implements OnModuleInit {
  private readonly logger = new Logger(PlantsRefreshService.name);
  private running = false;

  constructor(
    private readonly firebase: FirebaseService,
    private readonly config: ConfigService,
    private readonly scheduler: SchedulerRegistry,
    private readonly plants: PlantsService,
  ) {}

  onModuleInit(): void {
    if (!this.config.get<string>('GOOGLE_MAPS_API_KEY')) {
      // El refresco sigue programado igual: las tarifas y las clases salen del
      // listado del MTT, que no necesita ninguna clave. Sin la de Google solo se
      // pierden las coordenadas y los horarios.
      this.logger.warn(
        'Sin GOOGLE_MAPS_API_KEY: el refresco mensual traerá tarifas y clases, ' +
          'pero no actualizará ubicaciones ni horarios. Ver README.md.',
      );
    }

    const job = CronJob.from({
      // Segundo minuto hora díaDelMes mes díaSemana → 03:00 del día 1.
      cronTime: '0 0 3 1 * *',
      timeZone: 'America/Santiago',
      onTick: () => {
        void this.run();
      },
    });

    this.scheduler.addCronJob('refresco-plantas', job as never);
    job.start();

    this.logger.log('Catálogo de plantas: refresco automático el día 1 de cada mes a las 03:00');
  }

  /**
   * Refresca el catálogo y devuelve el resumen de lo que cambió.
   *
   * Primero el listado del MTT y después Google: el MTT es la fuente oficial de
   * qué plantas existen, cuánto cobran y qué vehículos atienden, y conviene
   * marcar las cerradas antes de gastar llamadas a Places averiguando el horario
   * de una planta que ya no opera.
   */
  async run(): Promise<RefreshResult | null> {
    const key = this.config.get<string>('GOOGLE_MAPS_API_KEY');

    // Dos corridas simultáneas gastarían el doble de API para el mismo resultado.
    if (this.running) {
      this.logger.warn('Ya hay un refresco en curso.');
      return null;
    }

    this.running = true;

    try {
      const snapshot = await this.firebase.db.collection(COLLECTIONS.plants).get();
      const seed: PlantSeed[] = snapshot.docs.map((doc) => {
        const data = doc.data() as PlantDoc & { placeId?: string | null };
        return {
          id: doc.id,
          company: data.company,
          comuna: data.comuna,
          address: data.address,
          classes: data.classes,
          lat: data.lat,
          lng: data.lng,
          precision: data.precision,
          phone: data.phone,
          schedule: data.schedule,
          scheduleSource: data.scheduleSource,
          placeId: data.placeId ?? null,
        };
      });

      if (seed.length === 0) {
        this.logger.warn('No hay plantas cargadas: corre "npm run seed" primero.');
        return null;
      }

      await this.refrescarTarifas(seed as unknown as PlantaCatalogo[]);

      if (!key) {
        this.plants.invalidateCache();
        return null;
      }

      const { plants, result } = await refreshFromPlaces(seed, key);
      await saveToFirestore(this.firebase.db, plants);
      this.plants.invalidateCache();

      this.logger.log(
        `Catálogo actualizado: ${result.withSchedule}/${result.total} con horario, ` +
          `${result.withPhone} con teléfono, ${result.moved} coordenadas corregidas.`,
      );

      if (result.closed.length > 0) {
        this.logger.warn(`Plantas cerradas según Google: ${result.closed.join(', ')}`);
      }

      return result;
    } catch (error) {
      this.logger.error(
        `Falló el refresco del catálogo: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    } finally {
      this.running = false;
    }
  }
  /**
   * Trae del MTT las tarifas, las clases y qué plantas siguen operando.
   *
   * Si falla no se aborta el refresco completo: el sitio del Ministerio se cae o
   * cambia de formato de vez en cuando, y perder las tarifas de este mes no es
   * motivo para perder también la actualización de ubicaciones y horarios.
   */
  private async refrescarTarifas(catalogo: PlantaCatalogo[]): Promise<void> {
    try {
      const resultado = await refreshTarifas(catalogo);
      await saveTarifas(this.firebase.db, catalogo, resultado);

      this.logger.log(
        `Tarifas del MTT (${resultado.vigencia}): ${resultado.actualizadas} plantas actualizadas, ` +
          `${resultado.sinFilaOficial.length} marcadas como cerradas, ` +
          `${resultado.faltantes.length} oficiales sin registrar en el catálogo.`,
      );

      for (const fila of resultado.faltantes) {
        this.logger.warn(
          `Planta oficial sin registrar: ${fila.codigo} · ${fila.comuna} · ${fila.direccion}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `No se pudieron actualizar las tarifas del MTT: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
