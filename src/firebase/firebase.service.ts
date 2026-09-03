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
    if (!(await this.ping())) {
      this.logger.error(
        'Firebase quedó inicializado pero Firestore no responde. Revisa las credenciales: ' +
          'en un servidor deben ir en FIREBASE_SERVICE_ACCOUNT_BASE64.',
      );
    }
  }

  get db(): Firestore {
    return this.firestore;
  }

  /** Comprobación de conectividad para el health check. */
  async ping(): Promise<boolean> {
    try {
      await this.firestore.listCollections();
      return true;
    } catch {
      return false;
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
