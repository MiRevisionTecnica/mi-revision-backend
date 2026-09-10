import type { DocumentKind, ReminderChannel } from '../common/enums.js';

/**
 * Nombres de las colecciones y forma de los documentos en Firestore.
 *
 * Firestore no tiene esquema ni claves únicas, así que las reglas del modelo se
 * sostienen desde aquí:
 *  - la unicidad de correo se apoya en `userEmails/{email}` escrito en la misma
 *    transacción que el usuario;
 *  - la unicidad de patente por usuario se valida dentro de una transacción;
 *  - `devices` usa el token de push como id del documento;
 *  - `reminderLogs` usa una clave compuesta como id, lo que hace el envío
 *    idempotente sin necesidad de leer antes de escribir.
 */
export const COLLECTIONS = {
  users: 'users',
  /** Índice de unicidad: id = correo en minúsculas → { userId }. */
  userEmails: 'userEmails',
  /** id = sha256 del refresh token, para buscarlo de un acceso directo. */
  refreshTokens: 'refreshTokens',
  vehicles: 'vehicles',
  documents: 'documents',
  /** id = ExponentPushToken[...]. */
  devices: 'devices',
  reminderLogs: 'reminderLogs',
  plants: 'plants',
} as const;

/** Cómo se autentica la cuenta. Una misma cuenta puede tener ambos. */
export type AuthProvider = 'password' | 'google';

export type UserDoc = {
  email: string;
  name: string;
  /** null en cuentas creadas con Google, que nunca tuvieron contraseña. */
  passwordHash: string | null;
  /** Identificador estable de Google (el claim "sub" del ID token). */
  googleId: string | null;
  photoUrl: string | null;
  providers: AuthProvider[];
  emailReminders: boolean;
  /**
   * Versión del texto legal que la persona aceptó al registrarse, y cuándo.
   *
   * Para hacer valer los términos hay que poder demostrar qué texto aceptó y en
   * qué momento, no solo que aceptó algo alguna vez. Es null en las cuentas
   * creadas antes de que la app pidiera la aceptación.
   */
  acceptedTermsVersion: string | null;
  acceptedTermsAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type RefreshTokenDoc = {
  userId: string;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
};

export type VehicleDoc = {
  userId: string;
  plate: string;
  brand: string;
  model: string;
  year: number | null;
  /** Fecha 'YYYY-MM-DD' por tipo de documento. */
  expirations: Partial<Record<DocumentKind, string>>;
  /**
   * Las mismas fechas en un arreglo plano. Firestore no sabe consultar dentro de
   * un mapa, así que este campo es el que permite al cron preguntar
   * `array-contains` por la fecha del día sin recorrer todos los vehículos.
   */
  dueDates: string[];
  createdAt: string;
  updatedAt: string;
};

export type DocumentDoc = {
  vehicleId: string;
  /** Se guarda también aquí para poder filtrar por dueño sin leer el vehículo. */
  userId: string;
  kind: DocumentKind;
  name: string;
  mimeType: string | null;
  size: number | null;
  storageUrl: string | null;
  uploadedAt: string;
};

export type DeviceDoc = {
  userId: string;
  platform: string | null;
  lastSeenAt: string;
  createdAt: string;
};

export type ReminderLogDoc = {
  vehicleId: string;
  kind: DocumentKind;
  dueDate: string;
  daysBefore: number;
  channel: ReminderChannel;
  sentAt: string;
};

/**
 * Un tramo de atención. Es un objeto y no una tupla porque Firestore **no
 * admite arreglos anidados**: `[["07:30","20:00"]]` es rechazado.
 */
export type TimeRange = { open: string; close: string };

/** Tramos de atención por día. Un día sin tramos está cerrado. */
export type WeeklySchedule = Record<
  'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun',
  TimeRange[]
>;

/**
 * Un valor de la revisión técnica.
 *
 * Se guarda como lista y no como un número suelto porque el trámite no tiene un
 * precio único: cambia por clase de vehículo y la revisión de gases puede ir
 * aparte. Una sola fila también es una lista válida.
 */
export type PlantPrice = {
  /** Qué cubre este valor: "Clase A", "Gases", "Motos". */
  label: string;
  /** Monto en pesos chilenos, sin decimales. */
  amount: number;
};

export type PlantDoc = {
  company: string;
  comuna: string;
  /** Comuna normalizada (sin tildes, minúsculas) para buscar sin acentos. */
  comunaSearch: string;
  address: string;
  lat: number;
  lng: number;
  classes: string[];
  phone: string | null;
  /** `null` significa "no tenemos el dato", que no es lo mismo que cerrado. */
  schedule: WeeklySchedule | null;
  scheduleSource: string | null;
  /** Identificador en Google Places, para refrescar sin volver a buscar. */
  placeId: string | null;
  /** 'places' | 'exact' | 'approx': qué tan fina es la ubicación. */
  precision: string;
  /** 'operational' | 'closed' según Google. Las cerradas no se listan. */
  status?: string;

  // --- Datos que NO vienen de Google ---
  // El refresco mensual escribe con merge y solo toca los campos de Places, así
  // que estos sobreviven. Es intencional: se cargan a mano y se perderían en el
  // primer refresco si ahí se escribiera el documento completo.

  /** Valores de la revisión. `null` = no tenemos el dato. */
  prices?: PlantPrice[] | null;
  /** Cuándo se verificaron los valores. Un precio sin fecha no dice nada. */
  pricesUpdatedAt?: string | null;
  /**
   * Página pública de la planta donde se ve la cámara del patio.
   *
   * Se enlaza la página de la planta y no el video crudo: esas cámaras muestran
   * patentes y personas, y redistribuir la señal desde nuestra app es distinto
   * de que la planta la publique. Enlazando, la planta conserva su atribución y
   * el enlace no se rompe si cambian de proveedor.
   */
  cameraUrl?: string | null;

  updatedAt: string;
};

/** id determinista del log de recordatorio: si ya existe, no se reenvía. */
export function reminderLogId(
  vehicleId: string,
  kind: DocumentKind,
  dueDate: string,
  daysBefore: number,
  channel: ReminderChannel,
): string {
  return `${vehicleId}_${kind}_${dueDate}_${daysBefore}_${channel}`;
}
