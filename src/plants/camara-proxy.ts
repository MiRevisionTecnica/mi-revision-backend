import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { get as getHttp } from 'node:http';
import { get as getHttps } from 'node:https';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rootCertificates } from 'node:tls';

/**
 * Trae la foto del patio de una planta y la sirve desde nuestra API.
 *
 * La app no pide la imagen directo a la planta, y no es por capricho:
 *
 *  - **TLS incompleto.** El servidor de cámaras de TÜV manda su certificado sin
 *    el intermedio. Los navegadores lo disimulan descargándolo al vuelo; Android
 *    no lo hace y falla el handshake. Acá se completa la cadena, sin desactivar
 *    ninguna verificación.
 *  - **HTTP sin cifrar.** Otras concesionarias publican en una IP desnuda. Que
 *    la app hable HTTP obliga a abrirle una excepción en el sistema; que lo haga
 *    el servidor no le cuesta nada a nadie.
 *  - **Datos móviles.** La misma foto pedida por diez personas se descarga una
 *    vez del servidor de la planta, no diez. Y de las cámaras que solo emiten
 *    flujo continuo se toma un cuadro y se corta: el flujo entrega megabytes por
 *    segundo, y para mirar una fila basta una foto.
 *
 * La caché es corta a propósito: la gracia de mirar el patio es ver la fila que
 * hay ahora.
 */

/** Cuánto se reutiliza una foto antes de volver a pedirla a la planta. */
const CACHE_MS = 8000;

/** Tope de tamaño, para que una fuente rara no llene la memoria del servidor. */
const MAX_BYTES = 8 * 1024 * 1024;

const TIMEOUT_MS = 12_000;

type Foto = { bytes: Buffer; tipo: string; at: number };

@Injectable()
export class CamaraProxy {
  private readonly logger = new Logger(CamaraProxy.name);
  private readonly cache = new Map<string, Foto>();
  private extras: string | null = null;

  /** Devuelve la foto del patio, recién pedida o de la caché. */
  async fetch(plantId: string, url: string): Promise<{ bytes: Buffer; tipo: string }> {
    const guardada = this.cache.get(plantId);
    if (guardada && Date.now() - guardada.at < CACHE_MS) {
      return { bytes: guardada.bytes, tipo: guardada.tipo };
    }

    try {
      const foto = await this.descargar(url);
      this.cache.set(plantId, { ...foto, at: Date.now() });
      return foto;
    } catch (error) {
      const detalle = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Cámara de ${plantId} no respondió: ${detalle}`);

      // Una foto de hace un rato es mejor que una pantalla de error: la fila no
      // cambia tanto en unos segundos.
      if (guardada) return { bytes: guardada.bytes, tipo: guardada.tipo };

      throw new ServiceUnavailableException('La cámara de esta planta no está respondiendo.');
    }
  }

  private async cadenasFaltantes(): Promise<string> {
    if (this.extras === null) {
      const aqui = dirname(fileURLToPath(import.meta.url));
      this.extras = await readFile(resolve(aqui, 'certs/cadenas-faltantes.pem'), 'utf8');
    }
    return this.extras;
  }

  private async descargar(url: string): Promise<{ bytes: Buffer; tipo: string }> {
    const seguro = url.startsWith('https:');
    const pedir = seguro ? getHttps : getHttp;

    const opciones: Record<string, unknown> = { headers: { 'user-agent': 'MiRevisionTecnica/1.0' } };
    if (seguro) opciones.ca = [...rootCertificates, await this.cadenasFaltantes()];

    return new Promise((cumplir, fallar) => {
      const peticion = pedir(url, opciones, (respuesta) => {
        if (respuesta.statusCode !== 200) {
          respuesta.resume();
          fallar(new Error(`respondió ${respuesta.statusCode}`));
          return;
        }

        const tipo = respuesta.headers['content-type'] ?? 'image/jpeg';
        const esFlujo = tipo.startsWith('multipart/');

        if (!tipo.startsWith('image/') && !esFlujo) {
          respuesta.resume();
          fallar(new Error(`devolvió ${tipo}, que no es una imagen`));
          return;
        }

        const trozos: Buffer[] = [];
        let total = 0;

        respuesta.on('data', (trozo: Buffer) => {
          total += trozo.length;

          if (total > MAX_BYTES) {
            respuesta.destroy();
            fallar(new Error('la imagen supera el tamaño máximo'));
            return;
          }

          trozos.push(trozo);

          // En un flujo continuo no hay "fin": se corta al tener el primer
          // cuadro completo. Sin esto la petición no terminaría nunca, y bajaría
          // megabytes por segundo para mostrar una sola imagen.
          if (!esFlujo) return;

          const cuadro = primerCuadro(Buffer.concat(trozos));
          if (!cuadro) return;

          respuesta.destroy();
          cumplir({ bytes: cuadro, tipo: 'image/jpeg' });
        });

        respuesta.on('end', () => {
          if (esFlujo) {
            const cuadro = primerCuadro(Buffer.concat(trozos));
            if (cuadro) {
              cumplir({ bytes: cuadro, tipo: 'image/jpeg' });
              return;
            }
            fallar(new Error('el flujo no entregó ningún cuadro completo'));
            return;
          }

          cumplir({ bytes: Buffer.concat(trozos), tipo });
        });
      });

      peticion.on('error', fallar);
      peticion.setTimeout(TIMEOUT_MS, () => {
        peticion.destroy(new Error('la cámara no respondió a tiempo'));
      });
    });
  }

  /** Para el controlador: la planta existe pero no publica foto. */
  static sinFoto(): never {
    throw new NotFoundException('Esta planta no publica una foto de su patio.');
  }
}

/**
 * El primer JPEG completo dentro de un flujo MJPEG.
 *
 * Se buscan las marcas de inicio y fin que define el formato --FF D8 y FF D9--
 * en vez de interpretar los límites del multipart: cada cámara arma sus
 * cabeceras a su manera, pero un JPEG empieza y termina igual en todas.
 */
function primerCuadro(datos: Buffer): Buffer | null {
  const inicio = datos.indexOf(Buffer.from([0xff, 0xd8]));
  if (inicio < 0) return null;

  const fin = datos.indexOf(Buffer.from([0xff, 0xd9]), inicio + 2);
  if (fin < 0) return null;

  return datos.subarray(inicio, fin + 2);
}
