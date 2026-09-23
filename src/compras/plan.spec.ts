import { describe, expect, it } from 'vitest';
import { planVigente, vehiculosPermitidos, VEHICULOS_GRATIS, VEHICULOS_PREMIUM } from './plan.js';

const HOY = new Date('2026-09-22T12:00:00Z');

describe('planVigente', () => {
  it('sin plan, no hay premium', () => {
    expect(planVigente(undefined, HOY)).toBe(false);
  });

  it('la suscripción vale hasta la fecha pagada', () => {
    expect(planVigente({ activo: true, hasta: '2026-10-22T00:00:00Z' }, HOY)).toBe(true);
  });

  it('una suscripción vencida deja de valer aunque quedara marcada como activa', () => {
    // Pasa de verdad: entre que la tienda avisa y nosotros lo anotamos hay un
    // rato, y en ese rato manda la fecha.
    expect(planVigente({ activo: true, hasta: '2026-09-01T00:00:00Z' }, HOY)).toBe(false);
  });

  it('el pago de por vida no vence', () => {
    expect(planVigente({ activo: true, hasta: null, tipo: 'unico' }, HOY)).toBe(true);
  });

  it('una devolución corta el acceso aunque la fecha no haya llegado', () => {
    expect(planVigente({ activo: false, hasta: '2027-01-01T00:00:00Z' }, HOY)).toBe(false);
  });
});

describe('vehiculosPermitidos', () => {
  it('gratis: uno', () => {
    expect(vehiculosPermitidos(undefined, HOY)).toBe(VEHICULOS_GRATIS);
  });

  it('con plan vigente: varios', () => {
    expect(vehiculosPermitidos({ activo: true, hasta: null }, HOY)).toBe(VEHICULOS_PREMIUM);
  });

  it('con plan vencido vuelve al límite gratis', () => {
    expect(vehiculosPermitidos({ activo: true, hasta: '2026-01-01T00:00:00Z' }, HOY)).toBe(
      VEHICULOS_GRATIS,
    );
  });
});
