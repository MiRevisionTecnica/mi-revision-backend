import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { DevicesService } from './devices.service.js';
import { DeviceResponse, RegisterDeviceDto } from './dto/device.dto.js';

@ApiTags('Dispositivos')
@ApiBearerAuth()
@Controller('devices')
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Post()
  @ApiOperation({
    summary: 'Registrar el token de push del teléfono',
    description: 'La app lo llama al iniciar sesión y cuando Expo renueva el token.',
  })
  @ApiResponse({ status: 201, type: DeviceResponse })
  register(
    @CurrentUser('id') userId: string,
    @Body() dto: RegisterDeviceDto,
  ): Promise<DeviceResponse> {
    return this.devices.register(userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Listar mis dispositivos registrados' })
  @ApiResponse({ status: 200, type: [DeviceResponse] })
  list(@CurrentUser('id') userId: string): Promise<DeviceResponse[]> {
    return this.devices.list(userId);
  }

  @Delete(':expoPushToken')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Dar de baja un dispositivo (al cerrar sesión)' })
  remove(
    @CurrentUser('id') userId: string,
    @Param('expoPushToken') expoPushToken: string,
  ): Promise<void> {
    return this.devices.remove(userId, expoPushToken);
  }
}
