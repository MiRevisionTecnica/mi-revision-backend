import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator.js';
import { PlantResponse, SearchPlantsDto } from './dto/plant.dto.js';
import { PlantsService } from './plants.service.js';

@ApiTags('Plantas PRT')
@Public()
@Controller('plants')
export class PlantsController {
  constructor(private readonly plants: PlantsService) {}

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

  @Get(':id')
  @ApiOperation({ summary: 'Ver una planta' })
  @ApiResponse({ status: 200, type: PlantResponse })
  findOne(@Param('id') id: string): Promise<PlantResponse> {
    return this.plants.findOne(id);
  }
}
