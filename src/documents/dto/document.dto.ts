import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, IsString, IsUrl, Max, MaxLength, Min } from 'class-validator';
import { DocumentKind } from '../../common/enums.js';

/** 10 MB: suficiente para una foto o un PDF de un certificado. */
const MAX_SIZE_BYTES = 10 * 1024 * 1024;

export class CreateDocumentDto {
  @ApiProperty({ enum: DocumentKind, example: DocumentKind.REVISION_TECNICA })
  @IsEnum(DocumentKind)
  kind: DocumentKind;

  @ApiProperty({ example: 'revision-tecnica-2026.jpg' })
  @IsString()
  @MaxLength(120)
  name: string;

  @ApiPropertyOptional({ example: 'image/jpeg' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  mimeType?: string;

  @ApiPropertyOptional({ example: 348212, description: 'Tamaño en bytes.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_SIZE_BYTES)
  size?: number;

  @ApiPropertyOptional({
    description: 'URL del archivo cuando exista almacenamiento en la nube. En la Fase 1 va vacío.',
  })
  @IsOptional()
  @IsUrl()
  storageUrl?: string;
}

export class DocumentResponse {
  @ApiProperty() id: string;
  @ApiProperty() vehicleId: string;
  @ApiProperty({ enum: DocumentKind }) kind: DocumentKind;
  @ApiProperty() name: string;
  @ApiPropertyOptional({ nullable: true }) mimeType: string | null;
  @ApiPropertyOptional({ nullable: true }) size: number | null;
  @ApiPropertyOptional({ nullable: true }) storageUrl: string | null;
  @ApiProperty() uploadedAt: Date;
}
