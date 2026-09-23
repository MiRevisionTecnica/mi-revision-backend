/**
 * Qué puede hacer una cuenta según su plan.
 *
 * Vive en el servidor, no en la app: un límite que solo existe en el teléfono
 * se salta reinstalando, y el que paga tiene que seguir teniendo lo suyo aunque
 * cambie de aparato --incluso de Android a iPhone--.
 *
 * El plan no se guarda como "premium sí o no", sino con **hasta cuándo**. Una
 * suscripción cancelada sigue valiendo hasta el final del período pagado: es lo
 * que exigen las dos tiendas y, sobre todo, lo justo. El pago único no tiene
 * fecha de término, y eso se representa con `null`.
 */

export type Plan = {
  activo: boolean;
  /** Hasta cuándo, en ISO. `null` en el pago de por vida. */
  hasta: string | null;
  /** 'mensual' | 'anual' | 'unico', para saber qué compró. */
  tipo?: string;
};

/** Vehículos que permite cada plan. */
export const VEHICULOS_GRATIS = 1;
export const VEHICULOS_PREMIUM = 10;

/**
 * Si el plan está vigente ahora.
 *
 * Se recalcula con la fecha y no se confía en el booleano guardado: entre que
 * la tienda avisa que alguien no renovó y que nuestro servidor lo anota puede
 * pasar un rato, y durante ese rato la fecha es la que dice la verdad.
 */
export function planVigente(plan: Plan | undefined, ahora = new Date()): boolean {
  if (!plan?.activo) return false;
  if (plan.hasta === null) return true;
  return new Date(plan.hasta).getTime() > ahora.getTime();
}

/** Cuántos vehículos puede tener esta cuenta. */
export function vehiculosPermitidos(plan: Plan | undefined, ahora = new Date()): number {
  return planVigente(plan, ahora) ? VEHICULOS_PREMIUM : VEHICULOS_GRATIS;
}
