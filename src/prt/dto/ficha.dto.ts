import { ApiProperty } from '@nestjs/swagger';
import { IsObject, IsString, Matches, MaxLength } from 'class-validator';

export class AbrirFichaDto {
  @ApiProperty({ example: 'ABCD12', description: 'Patente chilena: AB1234 o ABCD12.' })
  @IsString()
  @Matches(/^[A-Za-z]{2}\d{4}$|^[A-Za-z]{4}\d{2}$/, {
    message: 'La patente debe ser AB1234 o ABCD12.',
  })
  patente!: string;
}

export class EnviarFichaDto {
  @ApiProperty({ description: 'El identificador que devolvió la apertura de la consulta.' })
  @IsString()
  @MaxLength(64)
  sesion!: string;

  @ApiProperty({
    description:
      'Los campos del formulario del Ministerio, tal como los armó su página: __VIEWSTATE, __EVENTVALIDATION y el token del captcha que resolvió la persona.',
    type: 'object',
    additionalProperties: { type: 'string' },
  })
  @IsObject()
  campos!: Record<string, string>;
}

export class FichaResponse {
  @ApiProperty({ description: 'Identificador de esta consulta, para enviar el formulario.' })
  sesion!: string;

  @ApiProperty({ description: 'La página del Ministerio, lista para mostrarse en la app.' })
  html!: string;
}
