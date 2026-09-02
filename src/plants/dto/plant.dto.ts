import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsLatitude, IsLongitude, IsOptional, IsString, Max, Min } from 'class-validator';

export class SearchPlantsDto {
  @ApiPropertyOptional({ description: 'Texto libre: comuna, dirección o empresa.' })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ example: 'La Florida' })
  @IsOptional()
  @IsString()
  comuna?: string;

  @ApiPropertyOptional({
    example: -33.4489,
    description: 'Latitud del usuario. Con lat y lng el listado se ordena por cercanía.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  lat?: number;

  @ApiPropertyOptional({ example: -70.6693 })
  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  lng?: number;

  @ApiPropertyOptional({ default: 50, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class PlantResponse {
  @ApiProperty({ example: 'prt-25' }) id: string;
  @ApiProperty({ example: 'TÜV Rheinland Andino' }) company: string;
  @ApiProperty({ example: 'La Florida' }) comuna: string;
  @ApiProperty({ example: 'Av. Vicuña Mackenna Poniente 7955' }) address: string;
  @ApiProperty({ example: -33.515243 }) lat: number;
  @ApiProperty({ example: -70.60707 }) lng: number;
  @ApiProperty({ example: ['A', 'B'], description: 'A = livianos, B = pesados.' })
  classes: string[];
  @ApiPropertyOptional({ nullable: true }) phone: string | null;
  @ApiPropertyOptional({
    nullable: true,
    description:
      'Tramos de atención por día ({ mon: [{ open: "08:00", close: "18:00" }], … }). null = no tenemos el dato.',
  })
  schedule: Record<string, { open: string; close: string }[]> | null;
  @ApiPropertyOptional({ nullable: true, description: 'De dónde salió el horario.' })
  scheduleSource: string | null;
  @ApiProperty({
    enum: ['places', 'exact', 'address', 'street', 'comuna'],
    description: 'Qué tan precisa es la ubicación. Bajo "exact" conviene avisarlo en pantalla.',
  })
  precision: string;
  @ApiPropertyOptional({
    example: 2.4,
    description: 'Distancia en km. Solo cuando se envían lat y lng.',
  })
  distanceKm?: number;
}
