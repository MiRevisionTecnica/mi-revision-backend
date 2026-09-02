import { plainToInstance } from 'class-transformer';
import { existsSync } from 'node:fs';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

/**
 * Variables de entorno de la API. Se validan al arrancar: si falta algo
 * obligatorio el proceso no levanta, en vez de fallar más tarde en producción.
 */
export class Env {
  @IsIn(['development', 'test', 'production'])
  NODE_ENV: string = 'development';

  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  // --- Firebase ---
  // La app móvil nunca habla con Firebase: todo pasa por esta API, así que las
  // credenciales viven solo aquí. Se acepta el JSON completo en base64 (lo más
  // cómodo en Railway) o los tres campos por separado.

  /** Ruta al JSON de la cuenta de servicio. Lo más simple en desarrollo local. */
  @IsOptional()
  @IsString()
  GOOGLE_APPLICATION_CREDENTIALS?: string;

  /** JSON de la cuenta de servicio, codificado en base64. Ideal para Railway. */
  @IsOptional()
  @IsString()
  FIREBASE_SERVICE_ACCOUNT_BASE64?: string;

  @IsOptional()
  @IsString()
  FIREBASE_PROJECT_ID?: string;

  @IsOptional()
  @IsString()
  FIREBASE_CLIENT_EMAIL?: string;

  @IsOptional()
  @IsString()
  FIREBASE_PRIVATE_KEY?: string;

  /**
   * IDs de cliente OAuth aceptados al validar el ID token de Google, separados
   * por coma (el de web y el de Android/iOS). Sin esto, /auth/google responde 503.
   * Se obtienen al habilitar Google como proveedor en Firebase Authentication.
   */
  @IsOptional()
  @IsString()
  GOOGLE_OAUTH_CLIENT_IDS?: string;

  /**
   * Clave de Google Cloud con "Places API (New)" habilitada. Sin ella el
   * catálogo de plantas no se refresca solo y hay que mantenerlo a mano.
   */
  @IsOptional()
  @IsString()
  GOOGLE_MAPS_API_KEY?: string;

  /** Secreto para firmar los access token. Mínimo 32 caracteres. */
  @IsString()
  @MinLength(32)
  JWT_SECRET: string;

  @IsString()
  JWT_EXPIRES_IN: string = '1h';

  @IsInt()
  @Min(1)
  REFRESH_TOKEN_DAYS: number = 30;

  /** Orígenes permitidos por CORS, separados por coma. '*' permite todos. */
  @IsString()
  CORS_ORIGINS: string = '*';

  /** Límite de vehículos por cuenta. Fase 1 = 1; Fase 2 se sube aquí. */
  @IsInt()
  @Min(1)
  MAX_VEHICLES_PER_USER: number = 1;

  /** Días de anticipación de los recordatorios, separados por coma. */
  @IsString()
  REMINDER_OFFSETS: string = '30,15,7,1,0';

  /** Hora local (America/Santiago) a la que corre el cron de recordatorios. */
  @IsInt()
  @Min(0)
  @Max(23)
  REMINDER_HOUR: number = 9;

  @IsBoolean()
  REMINDERS_ENABLED: boolean = true;

  // --- Correo (opcional: sin SMTP configurado solo se envía push) ---

  @IsOptional()
  @IsString()
  SMTP_HOST?: string;

  @IsOptional()
  @IsInt()
  SMTP_PORT?: number;

  @IsOptional()
  @IsString()
  SMTP_USER?: string;

  @IsOptional()
  @IsString()
  SMTP_PASSWORD?: string;

  /** Admite tanto "correo@dominio" como "Nombre <correo@dominio>". */
  @IsOptional()
  @IsString()
  MAIL_FROM?: string;

  /** Token de Expo para push con credenciales mejoradas (opcional). */
  @IsOptional()
  @IsString()
  EXPO_ACCESS_TOKEN?: string;

  /**
   * Secreto que protege POST /api/reminders/run. Sin esta variable el endpoint
   * queda deshabilitado y los avisos salen solo por el cron interno.
   */
  @IsOptional()
  @IsString()
  @MinLength(16)
  CRON_SECRET?: string;
}

function toNumber(value: unknown): unknown {
  if (value === undefined || value === '') return undefined;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? value : parsed;
}

function toBoolean(value: unknown): unknown {
  if (value === undefined || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  return String(value).toLowerCase() === 'true';
}

export function validateEnv(raw: Record<string, unknown>): Env {
  // Una variable declarada pero vacía cuenta como ausente: así los .env de
  // plantilla (y los campos sin completar en Railway) caen en el valor por
  // defecto en vez de fallar la validación.
  const present = Object.fromEntries(
    Object.entries(raw).filter(([, value]) => value !== ''),
  );

  const normalized = {
    ...present,
    PORT: toNumber(present.PORT),
    SMTP_PORT: toNumber(present.SMTP_PORT),
    REFRESH_TOKEN_DAYS: toNumber(present.REFRESH_TOKEN_DAYS),
    MAX_VEHICLES_PER_USER: toNumber(present.MAX_VEHICLES_PER_USER),
    REMINDER_HOUR: toNumber(present.REMINDER_HOUR),
    REMINDERS_ENABLED: toBoolean(present.REMINDERS_ENABLED),
  };

  const env = plainToInstance(Env, normalized, {
    exposeDefaultValues: true,
    excludeExtraneousValues: false,
  });

  // Una ruta que no existe no cuenta como credencial: es el caso típico de
  // copiar el .env local al panel de un servidor.
  const hasCredentials =
    (Boolean(env.GOOGLE_APPLICATION_CREDENTIALS) &&
      existsSync(env.GOOGLE_APPLICATION_CREDENTIALS!)) ||
    Boolean(env.FIREBASE_SERVICE_ACCOUNT_BASE64) ||
    Boolean(env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY);

  if (!hasCredentials) {
    throw new Error(
      [
        'Configuración inválida: faltan las credenciales de Firebase.',
        '',
        'Descárgalas en la consola de Firebase:',
        '  Configuración del proyecto → Cuentas de servicio → Generar nueva clave privada',
        '',
        'Y define en el .env UNA de estas tres opciones:',
        '  1. GOOGLE_APPLICATION_CREDENTIALS=C:/ruta/a/clave.json   (la más simple en local)',
        '  2. FIREBASE_SERVICE_ACCOUNT_BASE64=<el JSON en base64>   (la más cómoda en Railway)',
        '  3. FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY',
        '',
        'Detalle en README.md → "Credenciales de Firebase".',
      ].join('\n'),
    );
  }

  const errors = validateSync(env, { skipMissingProperties: false });
  if (errors.length > 0) {
    const detail = errors
      .map((error) => `  - ${error.property}: ${Object.values(error.constraints ?? {}).join(', ')}`)
      .join('\n');
    throw new Error(`Configuración inválida:\n${detail}`);
  }

  return env;
}
