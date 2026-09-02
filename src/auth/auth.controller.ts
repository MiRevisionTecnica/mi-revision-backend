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
import { Public } from '../common/decorators/public.decorator.js';
import { AuthService } from './auth.service.js';
import {
  GoogleAuthDto,
  LoginDto,
  RefreshDto,
  RegisterDto,
  SessionResponse,
  UpdateProfileDto,
  UserResponse,
} from './dto/auth.dto.js';

@ApiTags('Autenticación')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Crear una cuenta' })
  @ApiResponse({ status: 201, type: SessionResponse })
  @ApiResponse({ status: 409, description: 'El correo ya está registrado' })
  register(@Body() dto: RegisterDto): Promise<SessionResponse> {
    return this.auth.register(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Iniciar sesión' })
  @ApiResponse({ status: 200, type: SessionResponse })
  @ApiResponse({ status: 401, description: 'Credenciales incorrectas' })
  login(@Body() dto: LoginDto): Promise<SessionResponse> {
    return this.auth.login(dto);
  }

  @Public()
  @Post('google')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Entrar con Google',
    description:
      'Recibe el ID token que la app obtuvo de Google, lo verifica y devuelve una sesión propia. Si el correo ya tenía cuenta con contraseña, la vincula en vez de duplicarla.',
  })
  @ApiResponse({ status: 200, type: SessionResponse })
  @ApiResponse({ status: 401, description: 'El ID token no es válido o el correo no está verificado' })
  @ApiResponse({ status: 503, description: 'Falta configurar GOOGLE_OAUTH_CLIENT_IDS en el servidor' })
  google(@Body() dto: GoogleAuthDto): Promise<SessionResponse> {
    return this.auth.loginWithGoogle(dto.idToken);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Renovar la sesión',
    description: 'Entrega un access token nuevo y rota el refresh token usado.',
  })
  @ApiResponse({ status: 200, type: SessionResponse })
  refresh(@Body() dto: RefreshDto): Promise<SessionResponse> {
    return this.auth.refresh(dto.refreshToken);
  }

  @ApiBearerAuth()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Cerrar sesión',
    description: 'Sin refreshToken en el cuerpo, cierra todas las sesiones del usuario.',
  })
  logout(
    @CurrentUser('id') userId: string,
    @Body() dto: Partial<RefreshDto>,
  ): Promise<void> {
    return this.auth.logout(userId, dto?.refreshToken);
  }

  @ApiBearerAuth()
  @Get('me')
  @ApiOperation({ summary: 'Datos del usuario autenticado' })
  @ApiResponse({ status: 200, type: UserResponse })
  me(@CurrentUser('id') userId: string): Promise<UserResponse> {
    return this.auth.me(userId);
  }

  @ApiBearerAuth()
  @Patch('me')
  @ApiOperation({ summary: 'Actualizar nombre o preferencia de correos' })
  @ApiResponse({ status: 200, type: UserResponse })
  updateProfile(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateProfileDto,
  ): Promise<UserResponse> {
    return this.auth.updateProfile(userId, dto);
  }

  @ApiBearerAuth()
  @Delete('me')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Eliminar la cuenta',
    description: 'Borra el usuario con sus vehículos, documentos y dispositivos.',
  })
  deleteAccount(@CurrentUser('id') userId: string): Promise<void> {
    return this.auth.deleteAccount(userId);
  }
}
