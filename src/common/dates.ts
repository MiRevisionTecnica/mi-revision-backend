/**
 * Utilidades de fecha. Las fechas de vencimiento son "fecha pura": no tienen
 * hora, así que se guardan y comparan en UTC a medianoche para que un usuario
 * en Chile y el servidor vean el mismo día.
 */

const MS_DAY = 24 * 60 * 60 * 1000;

/** Umbral en días bajo el cual un documento se considera "por vencer". */
export const SOON_THRESHOLD_DAYS = 30;

export type ExpirationStatus = 'vigente' | 'por_vencer' | 'vencido';

/** '2026-09-30' → Date en UTC a medianoche. */
export function toDateOnly(value: string | Date): Date {
  if (value instanceof Date) {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }

  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

/** Date → '2026-09-30'. */
export function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** Hoy a medianoche UTC, para comparar contra fechas puras. */
export function today(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Días que faltan para la fecha. Negativo si ya pasó. */
export function daysUntil(dueDate: Date, from: Date = today()): number {
  return Math.round((toDateOnly(dueDate).getTime() - from.getTime()) / MS_DAY);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_DAY);
}

export function statusFor(dueDate: Date, from: Date = today()): ExpirationStatus {
  const days = daysUntil(dueDate, from);
  if (days < 0) return 'vencido';
  if (days <= SOON_THRESHOLD_DAYS) return 'por_vencer';
  return 'vigente';
}

const MONTHS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

/** '2026-09-30' → '30 de septiembre de 2026', para los correos. */
export function formatLong(dueDate: Date): string {
  const date = toDateOnly(dueDate);
  return `${date.getUTCDate()} de ${MONTHS[date.getUTCMonth()]} de ${date.getUTCFullYear()}`;
}
