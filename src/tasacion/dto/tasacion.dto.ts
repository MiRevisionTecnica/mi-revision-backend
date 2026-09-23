import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumberString, IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class BuscarTasacionDto {
  @ApiPropertyOptional({
    example: 'HB2290192',
    description:
      'Código del SII. El permiso de circulación lo imprime con dígitos de más al final; se usan los primeros nueve.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  codigo?: string;

  @ApiPropertyOptional({ example: 'SUZUKI' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  marca?: string;

  @ApiPropertyOptional({ example: 'SWIFT' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  modelo?: string;

  @ApiProperty({ example: '2024', description: 'Año de fabricación del vehículo.' })
  @IsNumberString()
  @Length(4, 4)
  anio: string;
}

export class TasacionResponse {
  @ApiProperty({ example: 'HB2290192' }) codigo: string;
  @ApiProperty({ example: 'SUZUKI' }) marca: string;
  @ApiProperty({ example: 'SWIFT' }) modelo: string;
  @ApiProperty({ example: '1.2 GL' }) version: string;
  @ApiProperty({ example: '2024', description: 'Año de fabricación.' }) anio: string;
  @ApiProperty({ example: '2026', description: 'Año de la tasación vigente.' })
  anioTasacion: string;
  @ApiProperty({ example: 7365532, description: 'Tasación fiscal en pesos.' }) tasacion: number;
  @ApiProperty({ example: 105460, description: 'Lo que costaría el permiso de circulación.' })
  permiso: number;
}
