import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  applicationDefault,
  cert,
  getApps,
  initializeApp,
  type App,
  type ServiceAccount,
} from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { existsSync } from 'node:fs';

/**
 * Punto único de acceso a Firebase. La app móvil nunca habla con Firebase
 * directamente: pasa por esta API, así las credenciales viven solo en el servidor.
 *
 * Credenciales, en orden de preferencia:
 *   1. FIREBASE_SERVICE_ACCOUNT_BASE64 — el JSON de la cuenta de servicio en base64.
 *      Es lo más cómodo en Railway: cabe en una sola variable de entorno.
 *   2. FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY.
 *   3. GOOGLE_APPLICATION_CREDENTIALS — ruta a un archivo, útil en local.
 */
@Injectable()
export class FirebaseService implements OnModuleInit {
  private readonly logger = new Logger(FirebaseService.name);
  private app: App;
  private firestore: Firestore;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    // getApps() evita reinicializar cuando Nest recarga en modo watch.
    const existing = getApps();
    this.app = existing.length > 0 ? existing[0] : initializeApp(this.credentials());

    this.firestore = getFirestore(this.app);
    this.firestore.settings({ ignoreUndefinedProperties: true });

    this.logger.log(`Firebase inicializado (proyecto ${this.app.options.projectId})`);

    // Se comprueba la conexión al arrancar. Si las credenciales están mal, es
    // mejor decirlo ahora y con un mensaje claro que dejar que cada consulta
    // falle después con un stack trace de gRPC.
    const { reachable, reason } = await this.diagnose();
    if (!reachable) {
      this.logger.error(`Firebase inicializó, pero Firestore no responde. ${reason}`);
    }
  }

  get db(): Firestore {
    return this.firestore;
  }

  /** Comprobación de conectividad para el health check. */
  async ping(): Promise<boolean> {
    return (await this.diagnose()).reachable;
  }

  /**
   * Igual que ping(), pero explicando la falla.
   *
   * Un "no responde" a secas manda a revisar las credenciales, que es lo
   * primero que uno sospecha y muchas veces no es el problema: la credencial
   * puede estar impecable y la cuenta de servicio deshabilitada, o la base de
   * Firestore sin crear. Distinguirlos ahorra buscar donde no es.
   */
  async diagnose(): Promise<{ reachable: boolean; reason?: string }> {
    try {
      await this.firestore.listCollections();
      return { reachable: true };
    } catch (error) {
      return { reachable: false, reason: explainFirestoreError(error) };
    }
  }

  private credentials(): { credential: ReturnType<typeof cert>; projectId?: string } {
    // 1. Ruta al archivo JSON. Es lo más cómodo en local: se descarga la clave y
    //    se apunta a ella, sin convertir nada. firebase-admin lee la variable
    //    GOOGLE_APPLICATION_CREDENTIALS por su cuenta.
    //
    //    Se comprueba que el archivo exista antes de usarlo: una ruta de Windows
    //    copiada al panel de un servidor Linux no apunta a nada, y sin este
    //    control el error aparece recién en la primera consulta, disfrazado.
    const path = this.config.get<string>('GOOGLE_APPLICATION_CREDENTIALS');
    if (path) {
      if (existsSync(path)) {
        return {
          credential: applicationDefault(),
          projectId: this.config.get<string>('FIREBASE_PROJECT_ID'),
        };
      }

      this.logger.warn(
        `GOOGLE_APPLICATION_CREDENTIALS apunta a "${path}", que no existe en este equipo. ` +
          'Se ignora y se buscan las otras opciones. En un servidor usa ' +
          'FIREBASE_SERVICE_ACCOUNT_BASE64.',
      );
    }

    // 2. El JSON completo en base64: una sola variable, ideal para Railway.
    const raw = this.config.get<string>('FIREBASE_SERVICE_ACCOUNT_BASE64');
    if (raw) {
      const json = this.parseServiceAccount(raw);
      return { credential: cert(json), projectId: json.projectId ?? json.project_id };
    }

    // 3. Los tres campos por separado.
    const projectId = this.config.get<string>('FIREBASE_PROJECT_ID');
    const clientEmail = this.config.get<string>('FIREBASE_CLIENT_EMAIL');
    const privateKey = this.config.get<string>('FIREBASE_PRIVATE_KEY');

    if (projectId && clientEmail && privateKey) {
      return {
        credential: cert({
          projectId,
          clientEmail,
          // En las variables de entorno los saltos de línea viajan escapados.
          privateKey: privateKey.replace(/\\n/g, '\n'),
        }),
        projectId,
      };
    }

    throw new Error(
      'Faltan las credenciales de Firebase. En local sirve GOOGLE_APPLICATION_CREDENTIALS ' +
        'con la ruta al JSON; en Railway u otro servidor tiene que ser ' +
        'FIREBASE_SERVICE_ACCOUNT_BASE64. Ver README.md → "Credenciales de Firebase".',
    );
  }

  /**
   * Lee la cuenta de servicio desde FIREBASE_SERVICE_ACCOUNT_BASE64.
   *
   * Acepta el JSON en base64 y también el JSON pegado tal cual: copiar el
   * archivo en vez del base64 es el error más fácil de cometer al configurar
   * el panel de un servidor, y no hay motivo para castigarlo.
   *
   * Si no es ni lo uno ni lo otro se falla con un mensaje que dice qué pasó.
   * `Buffer.from(x, 'base64')` descarta en silencio los caracteres que no son
   * base64, así que sin esta comprobación el error que aparece es un
   * "Unexpected token" sobre un montón de binario, que no orienta a nadie.
   */
  private parseServiceAccount(raw: string): ServiceAccount & { project_id?: string } {
    const value = raw.trim();
    const text = value.startsWith('{')
      ? value
      : Buffer.from(value, 'base64').toString('utf8').trim();

    if (!text.startsWith('{')) {
      throw new Error(
        'FIREBASE_SERVICE_ACCOUNT_BASE64 no contiene la cuenta de servicio. ' +
          'Tiene que ser el JSON de la clave privada, en base64 y en una sola línea. ' +
          'En PowerShell: [Convert]::ToBase64String([IO.File]::ReadAllBytes("C:/ruta/al/clave.json")) | Set-Clipboard ' +
          '— y pegar lo que quedó en el portapapeles, no el comando ni el JSON sin codificar.',
      );
    }

    try {
      return JSON.parse(text) as ServiceAccount & { project_id?: string };
    } catch {
      throw new Error(
        'FIREBASE_SERVICE_ACCOUNT_BASE64 decodifica a algo que no es JSON válido. ' +
          'Es probable que el valor se haya cortado al pegarlo: el archivo completo ' +
          'son unos 3.200 caracteres en una sola línea.',
      );
    }
  }
}

/**
 * Traduce el error de Firestore a algo accionable.
 *
 * gRPC devuelve siempre el mismo "UNAUTHENTICATED: Request had invalid
 * authentication credentials" para causas muy distintas; el motivo real viaja
 * en `ACCOUNT_STATE_INVALID` y compañía, dentro de los detalles.
 */
function explainFirestoreError(error: unknown): string {
  const err = error as { code?: number; message?: string; statusDetails?: unknown[] };
  const message = err?.message ?? String(error);

  const reasons = (err?.statusDetails ?? [])
    .map((detail) => (detail as { reason?: string })?.reason)
    .filter(Boolean);

  if (reasons.includes('ACCOUNT_STATE_INVALID')) {
    return (
      'La cuenta de servicio está deshabilitada. Las credenciales están bien: hay que ' +
      'habilitarla en Google Cloud → IAM y administración → Cuentas de servicio. ' +
      'Si Google la deshabilitó por detectar la clave privada expuesta, además hay que ' +
      'generar una clave nueva y borrar la anterior, o la volverán a deshabilitar.'
    );
  }

  if (reasons.includes('SERVICE_DISABLED') || /has not been used|is disabled/i.test(message)) {
    return (
      'La API de Firestore está deshabilitada en el proyecto. Se habilita en ' +
      'Google Cloud → APIs y servicios → Cloud Firestore API.'
    );
  }

  if (err?.code === 5 || /NOT_FOUND|does not exist/i.test(message)) {
    return (
      'El proyecto existe pero no tiene base de datos de Firestore. Se crea en ' +
      'la consola de Firebase → Firestore Database → Crear base de datos.'
    );
  }

  if (err?.code === 7) {
    return (
      'La cuenta de servicio no tiene permisos sobre Firestore. Necesita el rol ' +
      '"Usuario de Cloud Datastore" en Google Cloud → IAM.'
    );
  }

  if (err?.code === 16) {
    return (
      'Google rechazó las credenciales. Revisa que FIREBASE_SERVICE_ACCOUNT_BASE64 ' +
      'corresponda a una clave vigente de este proyecto y que no se haya borrado ' +
      'en Google Cloud → IAM → Cuentas de servicio → Claves.'
    );
  }

  return message;
}
