import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common';

/**
 * Valida un id de documento de Firestore.
 *
 * Firestore genera ids de 20 caracteres alfanuméricos (`vYyIOJoqed4LVttZyoPb`),
 * no UUID: usar `ParseUUIDPipe` aquí rechazaría todos los ids válidos. Esta
 * comprobación es deliberadamente laxa —solo descarta lo que Firestore no
 * aceptaría— y evita que llegue basura a la ruta del documento.
 */
@Injectable()
export class FirestoreIdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    const id = value?.trim();

    // Firestore rechaza '.', '..', ids con '/' y los que empiezan y terminan
    // con doble guion bajo (reservados para uso interno).
    const valid =
      Boolean(id) &&
      id.length <= 1500 &&
      !id.includes('/') &&
      id !== '.' &&
      id !== '..' &&
      !/^__.*__$/.test(id);

    if (!valid) throw new BadRequestException('El identificador no es válido.');
    return id;
  }
}
