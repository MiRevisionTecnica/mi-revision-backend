import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator.js';
import { FirebaseService } from '../firebase/firebase.service.js';
import { RemindersService } from '../reminders/reminders.service.js';

@ApiTags('Estado')
@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly firebase: FirebaseService,
    private readonly reminders: RemindersService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Estado del servicio',
    description: 'Comprueba que la API responde y que Firestore está accesible.',
  })
  @ApiResponse({ status: 200, description: 'La API y Firestore responden' })
  async check() {
    const startedAt = Date.now();
    const { reachable, reason } = await this.firebase.diagnose();

    return {
      status: reachable ? 'ok' : 'degraded',
      firestore: reachable ? 'ok' : 'error',
      // El motivo se expone a propósito sin autenticación: describe la
      // configuración del servidor, no datos de nadie, y tenerlo acá evita
      // depender de los logs del proveedor para saber qué está roto.
      ...(reason ? { reason } : {}),
      // El último envío automático: si los avisos llevan días fallando, la API
      // igual responde y todo parece normal. Sin esto, la falla que más importa
      // es justo la que no se ve.
      reminders: this.reminders.lastAutomaticRun ?? 'sin ejecuciones desde el último arranque',
      latencyMs: Date.now() - startedAt,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}
