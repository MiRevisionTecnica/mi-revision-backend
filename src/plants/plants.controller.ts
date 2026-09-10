import { Controller, Get, Header, Param, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../common/decorators/public.decorator.js';
import { CamaraProxy } from './camara-proxy.js';
import { PlantResponse, SearchPlantsDto } from './dto/plant.dto.js';
import { PlantsService } from './plants.service.js';

@ApiTags('Plantas PRT')
@Public()
@Controller('plants')
export class PlantsController {
  constructor(
    private readonly plants: PlantsService,
    private readonly camaras: CamaraProxy,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Buscar plantas de revisión técnica',
    description:
      'Catálogo público de la Región Metropolitana. Con lat y lng el resultado viene ordenado por cercanía e incluye distanceKm.',
  })
  @ApiResponse({ status: 200, type: [PlantResponse] })
  search(@Query() query: SearchPlantsDto): Promise<PlantResponse[]> {
    return this.plants.search(query);
  }

  @Get('comunas')
  @ApiOperation({ summary: 'Comunas con plantas disponibles' })
  @ApiResponse({ status: 200, type: [String] })
  comunas(): Promise<string[]> {
    return this.plants.comunas();
  }

  @Get(':id/camara')
  @ApiOperation({
    summary: 'Foto del patio de la planta',
    description:
      'Devuelve la imagen que publica la planta. Va por acá y no directo desde la app porque algunas fuentes sirven sin cifrar y otras no entregan su certificado intermedio, que Android no sabe completar.',
  })
  @ApiResponse({ status: 200, description: 'La imagen (image/jpeg)' })
  @ApiResponse({ status: 404, description: 'La planta no publica foto de su patio' })
  @ApiResponse({ status: 503, description: 'La cámara de la planta no respondió' })
  // Se cachea poco: la gracia de mirar el patio es ver la fila que hay ahora.
  @Header('Cache-Control', 'public, max-age=8')
  async camara(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const planta = await this.plants.findOne(id);

    if (!planta.cameraUrl || planta.cameraType !== 'imagen') CamaraProxy.sinFoto();

    const { bytes, tipo } = await this.camaras.fetch(id, planta.cameraUrl);

    res.type(tipo).send(bytes);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Ver una planta' })
  @ApiResponse({ status: 200, type: PlantResponse })
  findOne(@Param('id') id: string): Promise<PlantResponse> {
    return this.plants.findOne(id);
  }
}
