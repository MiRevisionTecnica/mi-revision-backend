import { Module } from '@nestjs/common';
import { PlantsController } from './plants.controller.js';
import { PlantsRefreshService } from './plants-refresh.service.js';
import { PlantsService } from './plants.service.js';

@Module({
  controllers: [PlantsController],
  providers: [PlantsService, PlantsRefreshService],
})
export class PlantsModule {}
