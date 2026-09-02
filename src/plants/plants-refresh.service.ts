import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { COLLECTIONS, type PlantDoc } from '../firebase/collections.js';
import { FirebaseService } from '../firebase/firebase.service.js';
import { refreshFromPlaces, saveToFirestore, type PlantSeed, type RefreshResult } from './places-refresh.js';
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
      this.logger.warn(
        'Sin GOOGLE_MAPS_API_KEY: el catálogo de plantas no se refrescará solo. ' +
          'Ver README.md → "Catálogo de plantas PRT".',
      );
      return;
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

  /** Consulta Places y guarda. Devuelve el resumen de lo que cambió. */
  async run(): Promise<RefreshResult | null> {
    const key = this.config.get<string>('GOOGLE_MAPS_API_KEY');
    if (!key) return null;

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
}
