import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator.js';
import { FirebaseService } from '../firebase/firebase.service.js';

@ApiTags('Estado')
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly firebase: FirebaseService) {}

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
      latencyMs: Date.now() - startedAt,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}
