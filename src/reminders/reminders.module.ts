import { Module } from '@nestjs/common';
import { MailService } from './mail.service.js';
import { PushService } from './push.service.js';
import { RemindersController } from './reminders.controller.js';
import { RemindersService } from './reminders.service.js';

@Module({
  controllers: [RemindersController],
  providers: [RemindersService, PushService, MailService],
  exports: [RemindersService, PushService, MailService],
})
export class RemindersModule {}
