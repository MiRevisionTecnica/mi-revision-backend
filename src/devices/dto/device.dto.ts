import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterDeviceDto {
  @ApiProperty({
    example: 'fH3k…:APA91bF…',
    description:
      'Token de push del aparato. En Android es el token de FCM que entrega expo-notifications; en iOS, el de APNs.',
  })
  @IsString()
  // Sin patrón fijo a propósito: FCM no promete un formato para sus tokens y
  // atarse a uno haría que un cambio suyo rompiera el registro sin aviso.
  @MinLength(32, { message: 'El token de push no parece válido.' })
  @MaxLength(4096)
  pushToken: string;

  @ApiProperty({
    enum: ['fcm', 'apns'],
    description:
      'Con qué servicio se entrega. Lo decide la app según el tipo de token que le dio el sistema, no la plataforma: es lo que evita mandarle a FCM un token de Apple.',
  })
  @IsIn(['fcm', 'apns'])
  provider: 'fcm' | 'apns';

  @ApiPropertyOptional({ enum: ['android', 'ios'] })
  @IsOptional()
  @IsIn(['android', 'ios'])
  platform?: string;
}

export class DeviceResponse {
  @ApiProperty({ description: 'Hash del token: es el id del documento.' }) id: string;
  @ApiProperty() provider: string;
  @ApiPropertyOptional({ nullable: true }) platform: string | null;
  @ApiProperty() lastSeenAt: Date;
}
