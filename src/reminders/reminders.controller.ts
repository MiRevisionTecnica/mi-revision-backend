import {
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';
import { RemindersService } from './reminders.service.js';

@ApiTags('Recordatorios')
@Controller('reminders')
export class RemindersController {
  constructor(
    private readonly reminders: RemindersService,
    private readonly config: ConfigService,
  ) {}

  @ApiBearerAuth()
  @Get('preview')
  @ApiOperation({
    summary: 'Ver qué avisos tocarían hoy para mis vehículos',
    description: 'No envía nada. Sirve para revisar el contenido de los recordatorios.',
  })
  preview(@CurrentUser('id') userId: string) {
    return this.reminders.preview(userId);
  }

  @Public()
  @Post('run')
  @HttpCode(HttpStatus.OK)
  @ApiHeader({
    name: 'x-cron-secret',
    description: 'Debe coincidir con CRON_SECRET. Sin esa variable el endpoint queda deshabilitado.',
    required: true,
  })
  @ApiOperation({
    summary: 'Disparar el envío de recordatorios',
    description:
      'Pensado para un cron externo (Railway Scheduled Job). La operación es idempotente: repetirla en el mismo día no duplica avisos.',
  })
  @ApiResponse({ status: 200, description: 'Resumen de lo enviado' })
  @ApiResponse({ status: 403, description: 'Secreto ausente o incorrecto' })
  run(@Headers('x-cron-secret') secret?: string) {
    const expected = this.config.get<string>('CRON_SECRET');

    if (!expected || secret !== expected) {
      throw new ForbiddenException('Secreto de cron inválido.');
    }

    return this.reminders.run();
  }
}
