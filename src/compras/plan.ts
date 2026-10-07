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
  /**
   * El producto de la tienda, tal como lo informó RevenueCat.
   *
   * De acá sale cuántos vehículos trae el plan. Se guarda el identificador
   * crudo y no el número ya calculado: si mañana cambia cuántos vehículos da un
   * producto, el cambio vale para todos de inmediato, sin tener que recorrer
   * las cuentas una por una.
   */
  producto?: string;
  /**
   * Límite propio de esta cuenta, puesto a mano.
   *
   * Las tiendas venden productos de precio fijo: no hay forma de cobrar por
   * cantidad de vehículos dentro de la app. Los planes de empresa se acuerdan
   * y se facturan por fuera --Apple lo permite en su regla 3.1.3(c)-- y acá
   * queda anotado cuántos vehículos se contrataron.
   *
   * Solo vale mientras el plan esté vigente: si el contrato tiene fecha de
   * término y pasó, la cuenta vuelve sola al límite gratis.
   */
  vehiculos?: number;
};

/** Un vehículo, sin pagar nada. */
export const VEHICULOS_GRATIS = 1;

/**
 * Lo que trae un plan pagado cuyo producto no reconocemos.
 *
 * Pasa si la tienda informa un identificador nuevo que todavía no está en la
 * tabla de abajo. Se tira por lo bajo a propósito: es preferible que alguien
 * reclame porque le falta un cupo --y lo arreglamos en el acto-- a repartir
 * vehículos que nadie pagó.
 */
export const VEHICULOS_PREMIUM = 1;

/**
 * Cuántos vehículos trae cada producto.
 *
 * Hay dos escalones: uno para quien tiene un auto y quiere las ventajas de
 * Premium, y otro para una familia con hasta tres. Más que eso es una empresa,
 * y esas se atienden con un precio por vehículo facturado por fuera de las
 * tiendas, porque cobrar por cantidad dentro de la app no se puede.
 */
const VEHICULOS_POR_PRODUCTO: Record<string, number> = {
  premium_mensual: 1,
  premium_anual: 1,
  premium_mensual3: 3,
  premium_anual3: 3,
  premium_total: 3,
};

/**
 * Los vehículos que da un producto de la tienda.
 *
 * Google informa el identificador con el plan base pegado
 * --`premium_anual3:anual3`-- y Apple sin él. Se corta en los dos puntos para
 * que la misma tabla sirva para las dos tiendas.
 */
export function vehiculosDeProducto(producto: string | undefined): number {
  if (!producto) return VEHICULOS_PREMIUM;
  return VEHICULOS_POR_PRODUCTO[producto.split(':')[0]] ?? VEHICULOS_PREMIUM;
}

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

/**
 * Cuántos vehículos puede tener esta cuenta.
 *
 * Manda el mayor entre lo que trae el producto comprado y lo que alguien haya
 * anotado a mano para un cliente de flotilla. Nunca hacia abajo: un número mal
 * escrito en la base no puede quitarle a nadie lo que pagó en la tienda.
 */
export function vehiculosPermitidos(plan: Plan | undefined, ahora = new Date()): number {
  if (!planVigente(plan, ahora)) return VEHICULOS_GRATIS;

  const delProducto = vehiculosDeProducto(plan?.producto);

  const aMano = plan?.vehiculos;
  if (typeof aMano !== 'number' || !Number.isFinite(aMano)) return delProducto;

  return Math.max(Math.floor(aMano), delProducto);
}
