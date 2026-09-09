import { Module } from '@nestjs/common';
import { RemindersModule } from '../reminders/reminders.module.js';
import { HealthController } from './health.controller.js';

@Module({
  imports: [RemindersModule],
  controllers: [HealthController],
})
export class HealthModule {}
