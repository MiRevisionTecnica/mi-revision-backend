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

  onModuleInit(): void {
    // getApps() evita reinicializar cuando Nest recarga en modo watch.
    const existing = getApps();
    this.app = existing.length > 0 ? existing[0] : initializeApp(this.credentials());

    this.firestore = getFirestore(this.app);
    this.firestore.settings({ ignoreUndefinedProperties: true });

    this.logger.log(`Firebase inicializado (proyecto ${this.app.options.projectId})`);
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
    const path = this.config.get<string>('GOOGLE_APPLICATION_CREDENTIALS');
    if (path) {
      return {
        credential: applicationDefault(),
        projectId: this.config.get<string>('FIREBASE_PROJECT_ID'),
      };
    }

    // 2. El JSON completo en base64: una sola variable, ideal para Railway.
    const base64 = this.config.get<string>('FIREBASE_SERVICE_ACCOUNT_BASE64');
    if (base64) {
      const json = JSON.parse(
        Buffer.from(base64, 'base64').toString('utf8'),
      ) as ServiceAccount & { project_id?: string };

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
      'Faltan las credenciales de Firebase. Ver README.md → "Credenciales de Firebase".',
    );
  }
}
