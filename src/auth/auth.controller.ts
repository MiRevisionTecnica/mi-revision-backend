import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { AuthService } from './auth.service.js';
import { SyncSessionDto, UpdateProfileDto, UserResponse } from './dto/auth.dto.js';

/**
 * Perfil de la cuenta.
 *
 * Crear la cuenta, iniciar sesión, entrar con Google, recuperar la contraseña y
 * cerrar sesión ocurren en la app contra Firebase Authentication: ninguno de
 * esos pasos pasa por acá. Lo que queda es el perfil, y todo pide el ID token
 * de Firebase en el encabezado.
 */
@ApiTags('Cuenta')
@ApiBearerAuth()
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('session')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Registrar la sesión recién abierta',
    description:
      'Se llama apenas Firebase entrega una sesión. Crea el perfil si es la primera vez y deja registrada la versión de los términos aceptada.',
  })
  @ApiResponse({ status: 200, type: UserResponse })
  sincronizar(
    @CurrentUser('id') userId: string,
    @CurrentUser('email') email: string,
    @Body() dto: SyncSessionDto,
  ): Promise<UserResponse> {
    return this.auth.sincronizar(userId, email, dto);
  }

  @Get('me')
  @ApiOperation({ summary: 'Datos del usuario autenticado' })
  @ApiResponse({ status: 200, type: UserResponse })
  me(@CurrentUser('id') userId: string): Promise<UserResponse> {
    return this.auth.me(userId);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Actualizar el perfil o la preferencia de correos' })
  @ApiResponse({ status: 200, type: UserResponse })
  updateProfile(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateProfileDto,
  ): Promise<UserResponse> {
    return this.auth.updateProfile(userId, dto);
  }

  @Delete('me')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Eliminar la cuenta',
    description:
      'Borra el usuario con sus vehículos, documentos y dispositivos, y también su cuenta en Firebase Authentication.',
  })
  deleteAccount(@CurrentUser('id') userId: string): Promise<void> {
    return this.auth.deleteAccount(userId);
  }
}
