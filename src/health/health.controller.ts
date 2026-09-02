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
    const reachable = await this.firebase.ping();

    return {
      status: reachable ? 'ok' : 'degraded',
      firestore: reachable ? 'ok' : 'error',
      latencyMs: Date.now() - startedAt,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}
