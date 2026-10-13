import { randomInt } from 'node:crypto';

/**
 * Códigos que regalan Premium.
 *
 * Sirven para promociones, convenios con plantas de revisión, compensar a quien
 * tuvo un problema o dejar probar la app a un cliente antes de que pague.
 *
 * **Regalan, no venden.** Apple y Google prohíben cobrar funciones digitales
 * fuera de su sistema de pago, pero regalarlas es libre. Un código que alguien
 * compra en una web es motivo de retiro de la app; uno entregado sin cobrar no
 * tiene ningún problema.
 *
 * Lo que da el código se guarda aparte del plan de la tienda, nunca encima: si
 * compartieran el mismo campo, la próxima renovación que informe RevenueCat
 * borraría el regalo sin que nadie se entere.
 */

/** Hasta un año: más que eso es un convenio, y eso se escribe a mano. */
export const MESES_MAXIMOS = 12;

/** Lo que cubre el plan personal. Más vehículos que eso es una flotilla. */
export const VEHICULOS_PERSONAL_MAXIMO = 3;

/** Un tope para que un dedazo no entregue mil vehículos. */
export const VEHICULOS_FLOTILLA_MAXIMO = 100;

export type TipoDeCodigo = 'personal' | 'flotilla';

export type Codigo = {
  /** En mayúsculas y sin separadores; así se guarda y así se compara. */
  codigo: string;
  tipo: TipoDeCodigo;
  meses: number;
  vehiculos: number;
  /** Cuántas cuentas pueden canjearlo. */
  usosMaximos: number;
  usados: number;
  /** Hasta cuándo se puede canjear, en ISO. `null` si no caduca. */
  expiraEl: string | null;
  activo: boolean;
  /** Para qué se creó. Sin esto, en seis meses nadie recuerda qué era. */
  nota?: string;
  creadoEl: string;
};

/**
 * El alfabeto del código.
 *
 * Sin O ni 0, ni I ni 1: estos códigos se dictan por teléfono y se copian de un
 * papel, y esas confusiones generan reclamos de "no me funciona" que en realidad
 * son un carácter mal leído.
 */
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** `PREMIUM-7K3H-9DQ2`, legible y difícil de adivinar. */
export function generarCodigo(prefijo = 'PREM'): string {
  const parte = () =>
    Array.from({ length: 4 }, () => ALFABETO[randomInt(ALFABETO.length)]).join('');

  return `${prefijo.toUpperCase()}-${parte()}-${parte()}`;
}

/** Quita espacios y guiones para comparar: la gente los escribe como quiere. */
export function normalizarCodigo(codigo: string): string {
  return (codigo ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export type ProblemaDeCodigo =
  | 'no-existe'
  | 'desactivado'
  | 'expirado'
  | 'agotado'
  | 'ya-canjeado';

/**
 * Si esta cuenta puede canjear este código.
 *
 * Devuelve el motivo y no un simple `false` porque cada caso merece un mensaje
 * distinto: "ya lo usaste" y "se acabaron" son problemas diferentes para quien
 * está mirando la pantalla.
 */
export function problemaAlCanjear(
  codigo: Codigo | null,
  userId: string,
  yaCanjearon: string[],
  ahora = new Date(),
): ProblemaDeCodigo | null {
  if (!codigo) return 'no-existe';
  if (!codigo.activo) return 'desactivado';
  if (codigo.expiraEl && new Date(codigo.expiraEl).getTime() <= ahora.getTime()) return 'expirado';
  if (yaCanjearon.includes(userId)) return 'ya-canjeado';
  if (codigo.usados >= codigo.usosMaximos) return 'agotado';

  return null;
}

/**
 * Hasta cuándo queda el regalo.
 *
 * Se suma sobre lo que ya tenía regalado, no sobre hoy: quien canjea dos
 * códigos de tres meses tiene seis, no tres. El plan de la tienda va por su
 * lado y no se toca.
 */
export function vigenciaDelRegalo(
  meses: number,
  regaloActual: string | null,
  ahora = new Date(),
): string {
  const desde =
    regaloActual && new Date(regaloActual).getTime() > ahora.getTime()
      ? new Date(regaloActual)
      : new Date(ahora);

  return sumarMeses(desde, meses).toISOString();
}

/**
 * Suma meses en UTC y sin desbordar el mes.
 *
 * En hora local, Chile cambia de huso dos veces al año y el vencimiento se
 * corría una hora. Y sumar un mes al 31 de enero da el 3 de marzo, porque
 * febrero no tiene 31: en ese caso se deja el último día del mes que
 * corresponde, que es lo que cualquiera entiende por "un mes después".
 */
function sumarMeses(desde: Date, meses: number): Date {
  const dia = desde.getUTCDate();
  const resultado = new Date(desde);

  resultado.setUTCDate(1);
  resultado.setUTCMonth(resultado.getUTCMonth() + meses);

  const ultimoDelMes = new Date(
    Date.UTC(resultado.getUTCFullYear(), resultado.getUTCMonth() + 1, 0),
  ).getUTCDate();

  resultado.setUTCDate(Math.min(dia, ultimoDelMes));

  return resultado;
}

/** Qué se puede pedir al crear un código, ya validado. */
export type NuevoCodigo = {
  tipo: TipoDeCodigo;
  meses: number;
  vehiculos: number;
  usosMaximos: number;
  expiraEl: string | null;
  nota?: string;
};

/**
 * Revisa lo que se pidió crear.
 *
 * Los topes no son burocracia: un código de cien años o de mil vehículos
 * regalado por error no se puede deshacer una vez que alguien lo canjeó.
 */
export function problemaAlCrear(datos: NuevoCodigo): string | null {
  if (!Number.isInteger(datos.meses) || datos.meses < 1 || datos.meses > MESES_MAXIMOS) {
    return `Los meses van de 1 a ${MESES_MAXIMOS}.`;
  }

  if (!Number.isInteger(datos.vehiculos) || datos.vehiculos < 1) {
    return 'Los vehículos tienen que ser un número entero de 1 o más.';
  }

  if (datos.tipo === 'personal' && datos.vehiculos > VEHICULOS_PERSONAL_MAXIMO) {
    return `Un código personal llega hasta ${VEHICULOS_PERSONAL_MAXIMO} vehículos. Para más, usa uno de flotilla.`;
  }

  if (datos.tipo === 'flotilla' && datos.vehiculos > VEHICULOS_FLOTILLA_MAXIMO) {
    return `Un código de flotilla llega hasta ${VEHICULOS_FLOTILLA_MAXIMO} vehículos.`;
  }

  if (datos.tipo === 'flotilla' && datos.vehiculos <= VEHICULOS_PERSONAL_MAXIMO) {
    return `Una flotilla parte en ${VEHICULOS_PERSONAL_MAXIMO + 1} vehículos. Para menos, usa uno personal.`;
  }

  if (!Number.isInteger(datos.usosMaximos) || datos.usosMaximos < 1) {
    return 'El código tiene que poder usarse al menos una vez.';
  }

  if (datos.expiraEl && Number.isNaN(new Date(datos.expiraEl).getTime())) {
    return 'La fecha de expiración no es una fecha válida.';
  }

  return null;
}
