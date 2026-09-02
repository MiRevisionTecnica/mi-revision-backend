import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from './auth/auth.module.js';
import { JwtAuthGuard } from './auth/jwt-auth.guard.js';
import { validateEnv } from './config/env.js';
import { DevicesModule } from './devices/devices.module.js';
import { DocumentsModule } from './documents/documents.module.js';
import { HealthModule } from './health/health.module.js';
import { PlantsModule } from './plants/plants.module.js';
import { FirebaseModule } from './firebase/firebase.module.js';
import { RemindersModule } from './reminders/reminders.module.js';
import { VehiclesModule } from './vehicles/vehicles.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    ScheduleModule.forRoot(),
    FirebaseModule,
    AuthModule,
    VehiclesModule,
    DocumentsModule,
    PlantsModule,
    DevicesModule,
    RemindersModule,
    HealthModule,
  ],
  providers: [
    // Todo endpoint exige token salvo los marcados con @Public().
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
