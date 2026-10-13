import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumberString, IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class BuscarHomologacionDto {
  @ApiProperty({ example: 'SUZUKI' })
  @IsString()
  @MaxLength(40)
  marca: string;

  @ApiProperty({ example: 'SWIFT 1.2' })
  @IsString()
  @MaxLength(80)
  modelo: string;

  @ApiPropertyOptional({
    example: '2024',
    description: 'Año del vehículo. Descarta modelos homologados después de esa fecha.',
  })
  @IsOptional()
  @IsNumberString()
  @Length(4, 4)
  anio?: string;
}

export class HomologacionResponse {
  @ApiProperty({ example: 'Suzuki' }) marca: string;
  @ApiProperty({ example: 'Swift 1,2 Lts. DOHC Hatchback 5P. T/M Motor Otto' }) modelo: string;

  @ApiProperty({
    example: 'SZ5296E40713S',
    description: 'Código de informe técnico. Es el que viene impreso en el padrón.',
  })
  codigo: string;

  @ApiProperty({ example: 'C.H. 3507' }) certificado: string;

  @ApiProperty({
    example: '3-Sep-13',
    description: 'Cuándo se homologó el modelo, no el año del vehículo.',
  })
  fecha: string;

  @ApiProperty({ example: 'Gasolina' }) combustible: string;
  @ApiProperty({ example: '1.2' }) cilindrada: string;
  @ApiProperty({ example: 'M', description: 'M manual, A automática.' }) transmision: string;
  @ApiProperty({ example: 'Hatchback' }) carroceria: string;
  @ApiProperty({ example: 'Euro 5' }) norma: string;

  @ApiProperty({
    example: 2,
    description:
      'Cuántas palabras del modelo buscado calzaron. Sirve para saber si la primera es una respuesta segura o una entre varias parecidas.',
  })
  puntaje: number;
}
