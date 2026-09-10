import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';

/**
 * No hay nada que registrar para firmar tokens: los emite Firebase y los
 * verifica el guard con el SDK de administrador, que ya está disponible en toda
 * la aplicación porque FirebaseModule es global.
 */
@Module({
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
