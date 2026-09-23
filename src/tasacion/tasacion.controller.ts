import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator.js';
import { BuscarTasacionDto, TasacionResponse } from './dto/tasacion.dto.js';
import { SiiClient } from './sii.client.js';

/**
 * La tasación fiscal del SII, servida a través nuestro.
 *
 * Pasa por acá y no directo desde la app por las mismas razones de siempre: la
 * respuesta se cachea --la tasación cambia una vez al año-- y si el SII cambia
 * su servicio se arregla en un solo lugar, sin esperar que la gente actualice
 * la app.
 */
@ApiTags('Tasación fiscal')
@Public()
@Controller('tasacion')
export class TasacionController {
  constructor(private readonly sii: SiiClient) {}

  @Get()
  @ApiOperation({
    summary: 'Tasación fiscal y valor del permiso',
    description:
      'Por código del SII --el que imprime el permiso de circulación-- o por marca y modelo. Devuelve la tasación vigente y lo que costaría el permiso.',
  })
  @ApiResponse({ status: 200, type: [TasacionResponse] })
  async buscar(@Query() query: BuscarTasacionDto): Promise<TasacionResponse[]> {
    if (query.codigo) {
      const encontrada = await this.sii.porCodigo(query.codigo, query.anio);
      return encontrada ? [encontrada] : [];
    }

    if (!query.marca || !query.modelo) return [];
    return this.sii.porModelo(query.marca, query.modelo, query.anio);
  }

  @Get('marcas')
  @ApiOperation({ summary: 'Marcas que reconoce el SII' })
  @ApiResponse({ status: 200, type: [String] })
  marcas(): Promise<string[]> {
    return this.sii.marcas();
  }
}
