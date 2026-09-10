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
  ForgotPasswordDto,
  ResetPasswordDto,
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
    return this.auth.loginWithGoogle(dto.idToken, dto.acceptedTermsVersion);
  }

  @Public()
  @Public()
  @Post('forgot-password')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Pedir un código para recuperar la contraseña',
    description:
      'Responde 202 exista o no la cuenta. Confirmar cuáles correos están registrados convertiría este endpoint en una forma de averiguarlo.',
  })
  @ApiResponse({ status: 202, description: 'Si la cuenta existe, se envió el código' })
  async forgotPassword(@Body() dto: ForgotPasswordDto): Promise<{ message: string }> {
    await this.auth.forgotPassword(dto.email);
    return { message: 'Si el correo está registrado, te enviamos un código.' };
  }

  @Public()
  @Post('reset-password')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cambiar la contraseña con el código recibido' })
  @ApiResponse({ status: 200, description: 'Contraseña actualizada' })
  @ApiResponse({ status: 401, description: 'El código no es válido o ya venció' })
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<{ message: string }> {
    await this.auth.resetPassword(dto.email, dto.code, dto.password);
    return { message: 'Tu contraseña quedó actualizada. Inicia sesión con la nueva.' };
  }

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
