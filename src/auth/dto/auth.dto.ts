import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'Iván Pérez' })
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name: string;

  @ApiProperty({ example: 'ivan@ejemplo.cl' })
  @IsEmail({}, { message: 'Revisa tu correo electrónico.' })
  email: string;

  @ApiProperty({ example: 'unaClaveSegura', minLength: 8 })
  @IsString()
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres.' })
  @MaxLength(72)
  password: string;
}

export class LoginDto {
  @ApiProperty({ example: 'ivan@ejemplo.cl' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'unaClaveSegura' })
  @IsString()
  password: string;
}

export class GoogleAuthDto {
  @ApiProperty({
    description:
      'ID token que entrega Google en el teléfono. El backend lo verifica contra los client ID configurados; la app nunca habla con Firebase.',
  })
  @IsString()
  @IsNotEmpty()
  idToken: string;
}

export class RefreshDto {
  @ApiProperty({ description: 'Refresh token entregado al iniciar sesión.' })
  @IsString()
  refreshToken: string;
}

export class UpdateProfileDto {
  @ApiProperty({ required: false, example: 'Iván Pérez' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @ApiProperty({ required: false, description: 'Recibir avisos de vencimiento por correo.' })
  @IsOptional()
  @IsBoolean()
  emailReminders?: boolean;
}

export class UserResponse {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() email: string;
  @ApiProperty({
    enum: ['password', 'google'],
    isArray: true,
    description: 'Formas con las que esta cuenta puede iniciar sesión.',
  })
  providers: ('password' | 'google')[];
  @ApiProperty({ required: false, nullable: true }) photoUrl: string | null;
  @ApiProperty() emailReminders: boolean;
  @ApiProperty() createdAt: Date;
}

export class SessionResponse {
  @ApiProperty({ type: UserResponse }) user: UserResponse;
  @ApiProperty({ description: 'Token para el header Authorization: Bearer.' })
  accessToken: string;
  @ApiProperty({ description: 'Token de larga duración para renovar la sesión.' })
  refreshToken: string;
  @ApiProperty({ description: 'Segundos de validez del access token.', example: 3600 })
  expiresIn: number;
}
