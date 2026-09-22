import { Module } from '@nestjs/common';
import { FichaProxy } from './ficha-proxy.js';
import { PrtController } from './prt.controller.js';

@Module({
  controllers: [PrtController],
  providers: [FichaProxy],
})
export class PrtModule {}
