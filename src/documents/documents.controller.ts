import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { FirestoreIdPipe } from '../common/pipes/firestore-id.pipe.js';
import { DocumentsService } from './documents.service.js';
import { CreateDocumentDto, DocumentResponse } from './dto/document.dto.js';

@ApiTags('Documentos')
@ApiBearerAuth()
@Controller()
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get('vehicles/:vehicleId/documents')
  @ApiOperation({ summary: 'Listar los documentos de un vehículo' })
  @ApiResponse({ status: 200, type: [DocumentResponse] })
  list(
    @CurrentUser('id') userId: string,
    @Param('vehicleId', FirestoreIdPipe) vehicleId: string,
  ): Promise<DocumentResponse[]> {
    return this.documents.listByVehicle(userId, vehicleId);
  }

  @Post('vehicles/:vehicleId/documents')
  @ApiOperation({
    summary: 'Registrar un documento',
    description:
      'Guarda los metadatos. En la Fase 1 el archivo queda en el teléfono; cuando exista bucket se envía storageUrl.',
  })
  @ApiResponse({ status: 201, type: DocumentResponse })
  create(
    @CurrentUser('id') userId: string,
    @Param('vehicleId', FirestoreIdPipe) vehicleId: string,
    @Body() dto: CreateDocumentDto,
  ): Promise<DocumentResponse> {
    return this.documents.create(userId, vehicleId, dto);
  }

  @Delete('documents/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Eliminar un documento' })
  remove(
    @CurrentUser('id') userId: string,
    @Param('id', FirestoreIdPipe) id: string,
  ): Promise<void> {
    return this.documents.remove(userId, id);
  }
}
