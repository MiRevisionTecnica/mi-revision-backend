import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { FirestoreIdPipe } from '../common/pipes/firestore-id.pipe.js';
import { CreateVehicleDto, UpdateVehicleDto, VehicleResponse } from './dto/vehicle.dto.js';
import { VehiclesService } from './vehicles.service.js';

@ApiTags('Vehículos')
@ApiBearerAuth()
@Controller('vehicles')
export class VehiclesController {
  constructor(private readonly vehicles: VehiclesService) {}

  @Get()
  @ApiOperation({ summary: 'Listar mis vehículos con sus vencimientos' })
  @ApiResponse({ status: 200, type: [VehicleResponse] })
  list(@CurrentUser('id') userId: string): Promise<VehicleResponse[]> {
    return this.vehicles.list(userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Ver un vehículo' })
  @ApiResponse({ status: 200, type: VehicleResponse })
  @ApiResponse({ status: 404, description: 'No existe o no es tuyo' })
  findOne(
    @CurrentUser('id') userId: string,
    @Param('id', FirestoreIdPipe) id: string,
  ): Promise<VehicleResponse> {
    return this.vehicles.findOne(userId, id);
  }

  @Post()
  @ApiOperation({
    summary: 'Registrar un vehículo',
    description: 'El límite por cuenta se controla con MAX_VEHICLES_PER_USER (Fase 1: 1).',
  })
  @ApiResponse({ status: 201, type: VehicleResponse })
  @ApiResponse({ status: 403, description: 'Alcanzaste el límite de vehículos del plan' })
  @ApiResponse({ status: 409, description: 'Ya registraste esa patente' })
  create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateVehicleDto,
  ): Promise<VehicleResponse> {
    return this.vehicles.create(userId, dto);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Actualizar un vehículo',
    description: 'Si se envía "expirations", reemplaza por completo las fechas guardadas.',
  })
  @ApiResponse({ status: 200, type: VehicleResponse })
  update(
    @CurrentUser('id') userId: string,
    @Param('id', FirestoreIdPipe) id: string,
    @Body() dto: UpdateVehicleDto,
  ): Promise<VehicleResponse> {
    return this.vehicles.update(userId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Eliminar un vehículo con sus documentos y fechas' })
  remove(
    @CurrentUser('id') userId: string,
    @Param('id', FirestoreIdPipe) id: string,
  ): Promise<void> {
    return this.vehicles.remove(userId, id);
  }
}
