import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Post,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeEndpoint, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { timingSafeEqual } from 'node:crypto';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';
import { ComprasService, type AvisoDeCompra } from './compras.service.js';
import { PlanResponse } from './dto/plan.dto.js';

@ApiTags('Compras')
@Controller('compras')
export class ComprasController {
  constructor(
    private readonly compras: ComprasService,
    private readonly config: ConfigService,
  ) {}

  @Get('plan')
  @ApiOperation({
    summary: 'El plan de la cuenta',
    description:
      'Lo que vale hoy, calculado en el servidor. La app lo usa para mostrar el estado; el límite de vehículos se aplica igual aunque la app diga otra cosa.',
  })
  @ApiResponse({ status: 200, type: PlanResponse })
  plan(@CurrentUser('id') userId: string): Promise<PlanResponse> {
    return this.compras.plan(userId);
  }

  /**
   * Por donde RevenueCat avisa que alguien pagó, renovó o canceló.
   *
   * Es público porque lo llama un servidor ajeno, no la app, y se protege con
   * un secreto compartido en la cabecera `Authorization`, que es como
   * RevenueCat firma sus avisos. Sin secreto configurado el endpoint queda
   * cerrado: es preferible perder avisos a aceptar cualquiera que llegue, que
   * significaría regalar el plan a quien lo pida.
   */
  @Post('revenuecat')
  @Public()
  @HttpCode(200)
  @ApiExcludeEndpoint()
  async revenuecat(
    @Headers('authorization') autorizacion: string | undefined,
    @Body() cuerpo: { event?: AvisoDeCompra },
  ): Promise<{ resultado: string }> {
    const esperado = this.config.get<string>('REVENUECAT_SECRET');

    if (!esperado || !igual(autorizacion ?? '', esperado)) {
      throw new ForbiddenException('Aviso de compra no autorizado.');
    }

    if (!cuerpo.event) return { resultado: 'ignorado' };
    return { resultado: await this.compras.registrar(cuerpo.event) };
  }
}

/** Comparación de largo constante: un secreto no se compara con ===. */
function igual(recibido: string, esperado: string): boolean {
  const a = Buffer.from(recibido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}
