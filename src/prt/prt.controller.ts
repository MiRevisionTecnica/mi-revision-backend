import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator.js';
import { FichaProxy } from './ficha-proxy.js';
import { AbrirFichaDto, EnviarFichaDto, FichaResponse } from './dto/ficha.dto.js';

/**
 * La ficha del vehículo del Ministerio, servida a través nuestro.
 *
 * Es pública porque la app también deja usar la búsqueda sin cuenta, igual que
 * el catálogo de plantas: lo que se consulta es un dato público, con la patente
 * que la propia persona escribió.
 */
@ApiTags('Ficha del Ministerio')
@Public()
@Controller('prt')
export class PrtController {
  constructor(private readonly ficha: FichaProxy) {}

  @Get('ficha')
  @ApiOperation({
    summary: 'Abrir la consulta de una patente',
    description:
      'Devuelve la página del Ministerio con su captcha, para mostrarla en la app. Va por acá porque su servidor no entrega la cadena completa de su certificado y el navegador de Android no sabe completarla.',
  })
  @ApiResponse({ status: 200, type: FichaResponse })
  abrir(@Query() query: AbrirFichaDto): Promise<FichaResponse> {
    return this.ficha.abrir(query.patente);
  }

  @Post('ficha')
  @ApiOperation({
    summary: 'Enviar el formulario ya verificado',
    description:
      'Reenvía al Ministerio los campos de la página, incluido el token del captcha que resolvió la persona, y devuelve la respuesta.',
  })
  @ApiResponse({ status: 200, type: FichaResponse })
  async enviar(@Body() body: EnviarFichaDto): Promise<FichaResponse> {
    const html = await this.ficha.enviar(body.sesion, body.campos);
    return { sesion: body.sesion, html };
  }
}
