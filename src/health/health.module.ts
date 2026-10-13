import { Module } from '@nestjs/common';
import { HomologacionModule } from '../homologacion/homologacion.module.js';
import { RemindersModule } from '../reminders/reminders.module.js';
import { HealthController } from './health.controller.js';

@Module({
  imports: [RemindersModule, HomologacionModule],
  controllers: [HealthController],
})
export class HealthModule {}
