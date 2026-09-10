import { Module } from '@nestjs/common';
import { CamaraProxy } from './camara-proxy.js';
import { PlantsController } from './plants.controller.js';
import { PlantsRefreshService } from './plants-refresh.service.js';
import { PlantsService } from './plants.service.js';

@Module({
  controllers: [PlantsController],
  providers: [PlantsService, PlantsRefreshService, CamaraProxy],
})
export class PlantsModule {}
