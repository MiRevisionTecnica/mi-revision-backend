import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class SyncSessionDto {
  @ApiProperty({
    required: false,
    example: '2026-09-09',
    description:
      'Versión de los términos aceptados, en formato AAAA-MM-DD. Se manda al crear la cuenta y queda registrada con ella; en un inicio de sesión normal se omite.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'La versión de los términos debe ser AAAA-MM-DD.' })
  acceptedTermsVersion?: string;

  @ApiProperty({
    required: false,
    example: 'Iván Pérez',
    description:
      'Nombre para mostrar, al crear la cuenta. Existe porque el que la app le pone a la cuenta de Firebase puede no estar visible todavía cuando llega esta petición; sin él, el perfil nacería con el correo por nombre. Se ignora si el perfil ya existe.',
  })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;
}

export class UpdateProfileDto {
  @ApiProperty({ required: false, example: 'Iván Pérez' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @ApiProperty({ required: false, example: 'Iván' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  firstName?: string;

  @ApiProperty({ required: false, example: 'Pérez' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  lastName?: string;

  @ApiProperty({
    required: false,
    nullable: true,
    example: 'Nacho',
    description: 'Cómo prefiere que le hablemos. Si está, manda sobre el nombre.',
  })
  @IsOptional()
  @ValidateIf((_object: unknown, valor: unknown) => valor !== null)
  @IsString()
  @MaxLength(40)
  alias?: string | null;

  @ApiProperty({
    required: false,
    nullable: true,
    example: '+56 9 1234 5678',
    description: 'Teléfono de contacto. Se guarda tal como lo escribe la persona.',
  })
  @IsOptional()
  @ValidateIf((_object: unknown, valor: unknown) => valor !== null)
  @IsString()
  @Matches(/^[0-9+()\s-]{8,20}$/, { message: 'Revisa el número de teléfono.' })
  phone?: string | null;

  @ApiProperty({ required: false, description: 'Recibir avisos de vencimiento por correo.' })
  @IsOptional()
  @IsBoolean()
  emailReminders?: boolean;

  @ApiProperty({
    required: false,
    example: '2031-05-20',
    nullable: true,
    description:
      'Vencimiento de la licencia de conducir (AAAA-MM-DD). Va en la cuenta y no en el vehículo porque la licencia es de la persona. Enviar null para dejar de controlarla.',
  })
  @IsOptional()
  @ValidateIf((_object: unknown, valor: unknown) => valor !== null)
  @IsDateString({ strict: false }, { message: 'Usa el formato AAAA-MM-DD.' })
  licenseExpiresAt?: string | null;
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
  @ApiProperty({ nullable: true, example: '2031-05-20' }) licenseExpiresAt: string | null;
  @ApiProperty({ nullable: true }) firstName: string | null;
  @ApiProperty({ nullable: true }) lastName: string | null;
  @ApiProperty({ nullable: true, description: 'Cómo prefiere que le hablemos.' }) alias: string | null;
  @ApiProperty({ nullable: true }) phone: string | null;
}

