import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator.js';
import { FirebaseService } from '../firebase/firebase.service.js';
import { HomologacionService } from '../homologacion/homologacion.service.js';
import { ApnsService } from '../reminders/apns.service.js';
import { MailService } from '../reminders/mail.service.js';
import { RemindersService } from '../reminders/reminders.service.js';

@ApiTags('Estado')
@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly firebase: FirebaseService,
    private readonly reminders: RemindersService,
    private readonly mail: MailService,
    private readonly apple: ApnsService,
    private readonly homologacion: HomologacionService,
    private readonly config: ConfigService,
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
      // Sin SMTP los avisos salen solo por push y la recuperación de contraseña
      // no funciona, pero la API responde igual: sin esto, la única forma de
      // saberlo es abrir los logs del proveedor.
      correo: this.mail.transporte,
      // Sin clave de APNs los iPhone quedan sin avisos, y eso no se nota por
      // ningún otro lado hasta que alguien reclama.
      avisosApple: this.apple.disponible ? 'con clave' : 'sin configurar',
      // Sin el secreto, el webhook de compras queda cerrado: alguien podría
      // pagar y el plan no activarse nunca, y eso no se nota por ningún lado.
      compras: this.config.get<string>('REVENUECAT_SECRET') ? 'con secreto' : 'sin configurar',
      // Igual que arriba: sin ADMIN_SECRET no se pueden crear ni listar
      // códigos de regalo, y el endpoint responde lo mismo que si el secreto
      // estuviera mal escrito. Verlo acá evita perseguir un fantasma.
      codigos: this.config.get<string>('ADMIN_SECRET') ? 'con secreto' : 'sin configurar',
      // TEMPORAL: qué variables con "ADMIN" en el nombre ve el proceso. Solo
      // los nombres, nunca los valores, y entre comillas para que un espacio
      // al final se note. Se saca en cuanto se resuelva el enredo de Railway.
      variablesAdmin: Object.keys(process.env)
        .filter((nombre) => nombre.toUpperCase().includes('ADMIN'))
        .map((nombre) => `"${nombre}"`),
      // TEMPORAL también: dónde corre esto según el propio Railway, para
      // compararlo con el panel donde se editan las variables. Son nombres
      // que Railway inyecta solo; no hay secretos acá.
      donde: {
        servicio: process.env.RAILWAY_SERVICE_NAME ?? 'desconocido',
        entorno: process.env.RAILWAY_ENVIRONMENT_NAME ?? 'desconocido',
        variables: Object.keys(process.env).filter((n) => !n.startsWith('RAILWAY_')).length,
      },
      // La nómina del Ministerio se carga sola en la primera consulta. Acá se
      // mira sin provocar la descarga: solo dice si ya está y de cuándo es.
      homologacion: this.homologacion.estado(),
      latencyMs: Date.now() - startedAt,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}
