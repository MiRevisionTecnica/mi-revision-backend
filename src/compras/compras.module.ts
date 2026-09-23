import { Module } from '@nestjs/common';
import { ComprasController } from './compras.controller.js';
import { ComprasService } from './compras.service.js';

@Module({
  controllers: [ComprasController],
  providers: [ComprasService],
  exports: [ComprasService],
})
export class ComprasModule {}
