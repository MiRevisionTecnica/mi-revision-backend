import type { ConfigService } from '@nestjs/config';

/**
 * La hora en que salen los recordatorios cuando la persona no eligió ninguna.
 *
 * Vive acá y no en el servicio de recordatorios porque el perfil también la
 * necesita: es lo que se le muestra a alguien que nunca tocó la preferencia. Si
 * cada uno leyera la variable por su cuenta, bastaría cambiar el valor por
 * defecto en un lado para que la app mostrara una hora y el envío usara otra.
 */
export const HORA_POR_DEFECTO = 9;

export function horaPorDefecto(config: ConfigService): number {
  const hora = config.get<number>('REMINDER_HOUR', HORA_POR_DEFECTO);
  return Number.isInteger(hora) && hora >= 0 && hora <= 23 ? hora : HORA_POR_DEFECTO;
}

/** La hora que rige para esta persona: la suya, o la del servidor. */
export function horaDelUsuario(elegida: number | null | undefined, defecto: number): number {
  return typeof elegida === 'number' && Number.isInteger(elegida) && elegida >= 0 && elegida <= 23
    ? elegida
    : defecto;
}
