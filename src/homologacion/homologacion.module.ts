import { Module } from '@nestjs/common';
import { HomologacionController } from './homologacion.controller.js';
import { HomologacionService } from './homologacion.service.js';

@Module({
  controllers: [HomologacionController],
  providers: [HomologacionService],
  exports: [HomologacionService],
})
export class HomologacionModule {}
