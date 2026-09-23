import { Module } from '@nestjs/common';
import { SiiClient } from './sii.client.js';
import { TasacionController } from './tasacion.controller.js';

@Module({
  controllers: [TasacionController],
  providers: [SiiClient],
  exports: [SiiClient],
})
export class TasacionModule {}
