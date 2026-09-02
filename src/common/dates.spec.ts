import { daysUntil, formatLong, statusFor, toDateOnly, toIsoDate } from './dates.js';

describe('dates', () => {
  const hoy = toDateOnly('2026-09-02');

  it('convierte texto y fecha sin arrastrar la hora', () => {
    expect(toIsoDate(toDateOnly('2026-09-30'))).toBe('2026-09-30');
  });

  it('cuenta los días que faltan', () => {
    expect(daysUntil(toDateOnly('2026-09-30'), hoy)).toBe(28);
    expect(daysUntil(toDateOnly('2026-09-02'), hoy)).toBe(0);
    expect(daysUntil(toDateOnly('2026-08-30'), hoy)).toBe(-3);
  });

  it('clasifica el estado del vencimiento', () => {
    expect(statusFor(toDateOnly('2026-12-31'), hoy)).toBe('vigente');
    expect(statusFor(toDateOnly('2026-09-30'), hoy)).toBe('por_vencer');
    expect(statusFor(toDateOnly('2026-09-02'), hoy)).toBe('por_vencer');
    expect(statusFor(toDateOnly('2026-09-01'), hoy)).toBe('vencido');
  });

  it('formatea la fecha en español para los correos', () => {
    expect(formatLong(toDateOnly('2026-09-30'))).toBe('30 de septiembre de 2026');
  });
});
