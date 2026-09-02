import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { DocumentKind } from '../../common/enums.js';

/** Patentes chilenas: antiguas AB1234 y nuevas ABCD12. */
const PLATE_REGEX = /^([A-Z]{2}\d{4}|[A-Z]{4}\d{2})$/;

export class ExpirationDto {
  @ApiProperty({ enum: DocumentKind, example: DocumentKind.REVISION_TECNICA })
  @IsEnum(DocumentKind)
  kind: DocumentKind;

  @ApiProperty({ example: '2026-09-30', description: 'Fecha de vencimiento (YYYY-MM-DD).' })
  @IsDateString({ strict: false }, { message: 'Usa el formato YYYY-MM-DD.' })
  dueDate: string;
}

export class CreateVehicleDto {
  @ApiProperty({ example: 'ABCD12', description: 'Sin guiones ni espacios.' })
  @IsString()
  @Matches(PLATE_REGEX, { message: 'La patente debe tener el formato ABCD12 o AB1234.' })
  plate: string;

  @ApiProperty({ example: 'Chevrolet' })
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  brand: string;

  @ApiProperty({ example: 'Cruze LT' })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  model: string;

  @ApiPropertyOptional({ example: 2018 })
  @IsOptional()
  @IsInt()
  @Min(1900)
  @Max(2100)
  year?: number;

  @ApiPropertyOptional({ type: [ExpirationDto] })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ExpirationDto)
  expirations?: ExpirationDto[];
}

export class UpdateVehicleDto extends PartialType(CreateVehicleDto) {}

export class ExpirationResponse {
  @ApiProperty({ enum: DocumentKind }) kind: DocumentKind;
  @ApiProperty({ example: '2026-09-30' }) dueDate: string;
  @ApiProperty({ example: 28, description: 'Días que faltan. Negativo si ya venció.' })
  daysRemaining: number;
  @ApiProperty({ enum: ['vigente', 'por_vencer', 'vencido'] })
  status: 'vigente' | 'por_vencer' | 'vencido';
}

export class VehicleResponse {
  @ApiProperty() id: string;
  @ApiProperty({ example: 'ABCD12' }) plate: string;
  @ApiProperty() brand: string;
  @ApiProperty() model: string;
  @ApiPropertyOptional({ nullable: true }) year: number | null;
  @ApiProperty({ type: [ExpirationResponse] }) expirations: ExpirationResponse[];
  @ApiProperty() createdAt: Date;
}
