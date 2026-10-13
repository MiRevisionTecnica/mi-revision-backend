import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  MESES_MAXIMOS,
  VEHICULOS_FLOTILLA_MAXIMO,
  VEHICULOS_PERSONAL_MAXIMO,
} from '../codigo.js';

export class CrearCodigoDto {
  @ApiProperty({
    enum: ['personal', 'flotilla'],
    example: 'personal',
    description: `"personal" permite hasta ${VEHICULOS_PERSONAL_MAXIMO} vehículos; "flotilla", desde ${VEHICULOS_PERSONAL_MAXIMO + 1} y hasta ${VEHICULOS_FLOTILLA_MAXIMO}.`,
  })
  @IsIn(['personal', 'flotilla'])
  tipo: 'personal' | 'flotilla';

  @ApiProperty({
    example: 3,
    minimum: 1,
    maximum: MESES_MAXIMOS,
    description: `Cuántos meses de Premium regala. Hasta ${MESES_MAXIMOS}: más que eso es un convenio y se acuerda aparte.`,
  })
  @IsInt()
  @Min(1)
  @Max(MESES_MAXIMOS)
  meses: number;

  @ApiProperty({
    example: 1,
    minimum: 1,
    maximum: VEHICULOS_FLOTILLA_MAXIMO,
    description: 'Cuántos vehículos puede registrar quien lo canjee.',
  })
  @IsInt()
  @Min(1)
  @Max(VEHICULOS_FLOTILLA_MAXIMO)
  vehiculos: number;

  @ApiPropertyOptional({
    example: 50,
    default: 1,
    description:
      'Cuántas cuentas distintas pueden canjearlo. Cada cuenta lo usa una sola vez, aunque queden usos.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100000)
  usosMaximos?: number;

  @ApiPropertyOptional({
    example: '2026-12-31T23:59:59.000Z',
    description: 'Hasta cuándo se puede canjear. Si se omite, no caduca.',
  })
  @IsOptional()
  @IsISO8601()
  expiraEl?: string;

  @ApiPropertyOptional({
    example: 'Convenio planta Maipú, octubre 2026',
    description: 'Para qué se creó. En seis meses nadie recuerda qué era este código.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  nota?: string;

  @ApiPropertyOptional({
    example: 'VERANO2026',
    description:
      'Código a medida, para campañas. Si se omite se genera uno al azar, sin caracteres que se confundan al dictarlo.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  codigo?: string;
}

export class CanjearCodigoDto {
  @ApiProperty({
    example: 'PREM-7K3H-9DQ2',
    description: 'Da igual con mayúsculas, minúsculas, guiones o espacios.',
  })
  @IsString()
  @MaxLength(40)
  codigo: string;
}

export class CodigoResponse {
  @ApiProperty({ example: 'PREM7K3H9DQ2' }) codigo: string;
  @ApiProperty({ enum: ['personal', 'flotilla'] }) tipo: 'personal' | 'flotilla';
  @ApiProperty({ example: 3 }) meses: number;
  @ApiProperty({ example: 1 }) vehiculos: number;
  @ApiProperty({ example: 50 }) usosMaximos: number;
  @ApiProperty({ example: 12, description: 'Cuántas veces se ha canjeado.' }) usados: number;
  @ApiProperty({ example: null, nullable: true }) expiraEl: string | null;
  @ApiProperty({ example: true }) activo: boolean;
  @ApiPropertyOptional({ example: 'Convenio planta Maipú' }) nota?: string;
  @ApiProperty({ example: '2026-10-13T16:00:00.000Z' }) creadoEl: string;
}

export class CanjeResponse {
  @ApiProperty({ example: true }) premium: boolean;

  @ApiProperty({
    example: '2027-01-13T16:00:00.000Z',
    nullable: true,
    description: 'Hasta cuándo tiene Premium, contando también lo comprado en la tienda.',
  })
  hasta: string | null;

  @ApiProperty({ example: 3, description: 'Cuántos vehículos puede registrar ahora.' })
  vehiculos: number;

  @ApiProperty({ example: 3, description: 'Cuántos meses sumó este canje.' })
  meses: number;
}
