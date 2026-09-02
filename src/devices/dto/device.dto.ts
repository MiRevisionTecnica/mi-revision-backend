import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches } from 'class-validator';

export class RegisterDeviceDto {
  @ApiProperty({
    example: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]',
    description: 'Token entregado por expo-notifications en el dispositivo.',
  })
  @IsString()
  @Matches(/^Expo(nent)?PushToken\[.+\]$/, {
    message: 'El token debe tener el formato ExponentPushToken[...].',
  })
  expoPushToken: string;

  @ApiPropertyOptional({ enum: ['android', 'ios'] })
  @IsOptional()
  @IsIn(['android', 'ios'])
  platform?: string;
}

export class DeviceResponse {
  @ApiProperty() id: string;
  @ApiProperty() expoPushToken: string;
  @ApiPropertyOptional({ nullable: true }) platform: string | null;
  @ApiProperty() lastSeenAt: Date;
}
