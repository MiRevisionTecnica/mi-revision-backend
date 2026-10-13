import { Module } from '@nestjs/common';
import { CodigosController } from './codigos.controller.js';
import { CodigosService } from './codigos.service.js';

@Module({
  controllers: [CodigosController],
  providers: [CodigosService],
  exports: [CodigosService],
})
export class CodigosModule {}
