import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator.js';
import { BuscarHomologacionDto, HomologacionResponse } from './dto/homologacion.dto.js';
import { HomologacionService } from './homologacion.service.js';

/**
 * La homologación de un vehículo, desde la nómina oficial del Ministerio.
 *
 * No existe consulta por patente y no va a existir: el certificado se le otorga
 * a un modelo completo, no a un auto. Por eso se busca por marca y modelo, que
 * es lo que ya sabemos del vehículo después de consultar la patente.
 *
 * Devuelve varias candidatas ordenadas en vez de fingir una sola respuesta.
 * "Swift" son cuarenta y una filas --manual, automática, hatchback, sedán-- y
 * cada una tiene su propio código: elegir una al azar sería inventar un dato.
 */
@ApiTags('Homologación')
@Public()
@Controller('homologacion')
export class HomologacionController {
  constructor(private readonly homologacion: HomologacionService) {}

  @Get()
  @ApiOperation({
    summary: 'Homologación por marca y modelo',
    description:
      'Busca en la nómina del 3CV del Ministerio de Transportes. Devuelve las versiones que calzan, de la más parecida a la menos.',
  })
  @ApiResponse({ status: 200, type: [HomologacionResponse] })
  async buscar(@Query() query: BuscarHomologacionDto): Promise<HomologacionResponse[]> {
    return this.homologacion.buscar({
      marca: query.marca,
      modelo: query.modelo,
      anio: query.anio ? Number(query.anio) : undefined,
    });
  }
}
