import { planVigente } from '../compras/plan.js';
import type { UserDoc } from '../firebase/collections.js';

/**
 * Con cuántos días de anticipación se avisa.
 *
 * El plan gratis usa los días que fija el servidor --30, 15, 7, 1 y el mismo
 * día--, que cubren bien el caso típico. Premium puede elegir los suyos: hay
 * quien quiere saberlo con dos meses porque agenda la revisión con tiempo, y
 * quien solo quiere el aviso de la semana anterior y nada más.
 *
 * La elección no es libre sino de esta lista. El cron busca los vencimientos
 * por fecha, así que cada día posible es una consulta más: una lista cerrada
 * mantiene el costo fijo y no cambia nada para quien no la usa.
 */
export const ANTICIPACIONES_POSIBLES = [60, 45, 30, 21, 15, 10, 7, 5, 3, 1, 0] as const;

/** Cuántos días puede elegir una persona. Más que esto es ruido, no ayuda. */
export const MAXIMO_ELEGIBLE = 6;

export function esAnticipacionValida(dias: number): boolean {
  return (ANTICIPACIONES_POSIBLES as readonly number[]).includes(dias);
}

/**
 * Los días de anticipación de esta persona.
 *
 * Se respeta su elección solo mientras tenga el plan vigente: si deja de
 * pagarlo, vuelve a los días por defecto en lugar de quedarse sin avisos.
 */
export function anticipacionesDe(user: UserDoc, porDefecto: number[]): number[] {
  const elegidas = user.reminderOffsets ?? null;

  if (!elegidas?.length || !planVigente(user.plan ?? undefined)) return porDefecto;

  return [...new Set(elegidas.filter(esAnticipacionValida))].sort((a, b) => b - a);
}

/** Todos los días que el cron tiene que revisar, sin repetir. */
export function diasAConsultar(porDefecto: number[]): number[] {
  return [...new Set([...porDefecto, ...ANTICIPACIONES_POSIBLES])].sort((a, b) => b - a);
}
