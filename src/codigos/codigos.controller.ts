import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { timingSafeEqual } from 'node:crypto';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';
import { CanjeResponse, CanjearCodigoDto, CodigoResponse, CrearCodigoDto } from './dto/codigos.dto.js';
import { CodigosService } from './codigos.service.js';

/**
 * Códigos que regalan Premium.
 *
 * Hay dos públicos distintos y por eso dos formas de entrar:
 *
 * - **Crear y administrar** lo hace quien tiene el secreto `ADMIN_SECRET`, que
 *   vive solo en las variables del servidor. No hay usuarios administradores en
 *   la app, y no hacen falta: con un puñado de códigos al mes, un encabezado es
 *   más simple y más seguro que un rol que alguien podría llegar a tener por
 *   error.
 * - **Canjear** lo hace la persona desde la app, con su sesión.
 *
 * Los códigos **regalan, no venden**. Apple y Google prohíben cobrar funciones
 * digitales fuera de su sistema de pago; regalarlas es libre. Vender un código
 * en una web para obtener Premium es motivo de retiro de la app.
 */
@ApiTags('Códigos de regalo')
@Controller('codigos')
export class CodigosController {
  constructor(
    private readonly codigos: CodigosService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Post()
  @ApiHeader({
    name: 'x-admin-secret',
    description: 'Debe coincidir con ADMIN_SECRET. Sin esa variable el endpoint queda deshabilitado.',
    required: true,
  })
  @ApiOperation({
    summary: 'Crear un código',
    description:
      'Devuelve el código generado. Si no se indica uno a medida, se arma al azar sin caracteres que se confundan al dictarlo por teléfono (ni O ni 0, ni I ni 1).',
  })
  @ApiResponse({ status: 201, type: CodigoResponse })
  @ApiResponse({ status: 400, description: 'Datos fuera de rango, o el código ya existe' })
  @ApiResponse({ status: 403, description: 'Secreto ausente o incorrecto' })
  crear(@Body() body: CrearCodigoDto, @Headers('x-admin-secret') secreto?: string) {
    this.exigirSecreto(secreto);

    return this.codigos.crear({
      tipo: body.tipo,
      meses: body.meses,
      vehiculos: body.vehiculos,
      usosMaximos: body.usosMaximos ?? 1,
      expiraEl: body.expiraEl ?? null,
      nota: body.nota,
      codigo: body.codigo,
    });
  }

  @Public()
  @Get()
  @ApiHeader({ name: 'x-admin-secret', required: true })
  @ApiOperation({ summary: 'Listar códigos', description: 'Del más nuevo al más antiguo.' })
  @ApiResponse({ status: 200, type: [CodigoResponse] })
  listar(@Query('limite') limite?: string, @Headers('x-admin-secret') secreto?: string) {
    this.exigirSecreto(secreto);
    return this.codigos.listar(Math.min(Number(limite) || 100, 500));
  }

  @Public()
  @Get(':codigo')
  @ApiHeader({ name: 'x-admin-secret', required: true })
  @ApiOperation({ summary: 'Ver un código', description: 'Incluye cuántas veces se ha canjeado.' })
  @ApiResponse({ status: 200, type: CodigoResponse })
  @ApiResponse({ status: 404, description: 'No existe' })
  ver(@Param('codigo') codigo: string, @Headers('x-admin-secret') secreto?: string) {
    this.exigirSecreto(secreto);
    return this.codigos.ver(codigo);
  }

  @Public()
  @Delete(':codigo')
  @ApiHeader({ name: 'x-admin-secret', required: true })
  @ApiOperation({
    summary: 'Desactivar un código',
    description:
      'No lo borra: deja de aceptarse y el historial queda. Borrarlo dejaría a quien ya lo canjeó con un regalo imposible de rastrear.',
  })
  @ApiResponse({ status: 200, type: CodigoResponse })
  desactivar(@Param('codigo') codigo: string, @Headers('x-admin-secret') secreto?: string) {
    this.exigirSecreto(secreto);
    return this.codigos.desactivar(codigo);
  }

  @Post('canjear')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Canjear un código',
    description:
      'Lo hace la persona desde la app, con su sesión. Cada cuenta canjea un código una sola vez, aunque le queden usos. Si ya tenía un regalo vigente, los meses se suman en vez de reemplazarse.',
  })
  @ApiResponse({ status: 200, type: CanjeResponse })
  @ApiResponse({ status: 400, description: 'El código no existe, venció, se agotó o ya lo usó' })
  canjear(@CurrentUser('id') userId: string, @Body() body: CanjearCodigoDto) {
    return this.codigos.canjear(userId, body.codigo);
  }

  private exigirSecreto(recibido?: string): void {
    const esperado = this.config.get<string>('ADMIN_SECRET');

    if (!esperado || !igual(recibido ?? '', esperado)) {
      throw new ForbiddenException('Secreto de administración inválido.');
    }
  }
}

/** Comparación de largo constante: un secreto no se compara con ===. */
function igual(recibido: string, esperado: string): boolean {
  const a = Buffer.from(recibido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}
