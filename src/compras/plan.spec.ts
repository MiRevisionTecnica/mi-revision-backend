import { describe, expect, it } from 'vitest';
import {
  planVigente,
  vehiculosDeProducto,
  vehiculosPermitidos,
  VEHICULOS_GRATIS,
  VEHICULOS_PREMIUM,
} from './plan.js';

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

describe('vehiculosDeProducto', () => {
  it('el plan de un vehículo da uno', () => {
    expect(vehiculosDeProducto('premium_mensual')).toBe(1);
    expect(vehiculosDeProducto('premium_anual')).toBe(1);
  });

  it('el plan de tres vehículos da tres', () => {
    expect(vehiculosDeProducto('premium_mensual3')).toBe(3);
    expect(vehiculosDeProducto('premium_anual3')).toBe(3);
  });

  it('Google manda el plan base pegado y se entiende igual', () => {
    expect(vehiculosDeProducto('premium_anual3:anual3')).toBe(3);
    expect(vehiculosDeProducto('premium_anual:anual1')).toBe(1);
  });

  it('un producto que no conocemos cae al mínimo, no reparte cupos de más', () => {
    expect(vehiculosDeProducto('premium_inventado')).toBe(VEHICULOS_PREMIUM);
    expect(vehiculosDeProducto(undefined)).toBe(VEHICULOS_PREMIUM);
  });
});

describe('vehiculosPermitidos', () => {
  it('gratis: uno', () => {
    expect(vehiculosPermitidos(undefined, HOY)).toBe(VEHICULOS_GRATIS);
  });

  it('el plan de tres vehículos permite tres', () => {
    expect(
      vehiculosPermitidos({ activo: true, hasta: null, producto: 'premium_anual3:anual3' }, HOY),
    ).toBe(3);
  });

  it('el plan de un vehículo permite uno, con todas las ventajas', () => {
    expect(
      vehiculosPermitidos({ activo: true, hasta: null, producto: 'premium_mensual:mensual' }, HOY),
    ).toBe(1);
  });

  it('con plan vencido vuelve al límite gratis', () => {
    expect(
      vehiculosPermitidos(
        { activo: true, hasta: '2026-01-01T00:00:00Z', producto: 'premium_anual3' },
        HOY,
      ),
    ).toBe(VEHICULOS_GRATIS);
  });

  it('un límite puesto a mano manda: es el plan de flotilla', () => {
    expect(vehiculosPermitidos({ activo: true, hasta: null, vehiculos: 50 }, HOY)).toBe(50);
  });

  it('el límite a mano no puede dejar a alguien con menos de lo que pagó', () => {
    expect(
      vehiculosPermitidos(
        { activo: true, hasta: null, producto: 'premium_anual3', vehiculos: 2 },
        HOY,
      ),
    ).toBe(3);
  });

  it('un límite a mano no revive un contrato vencido', () => {
    expect(
      vehiculosPermitidos({ activo: true, hasta: '2026-01-01T00:00:00Z', vehiculos: 50 }, HOY),
    ).toBe(VEHICULOS_GRATIS);
  });

  it('un valor sin sentido no rompe nada: se ignora', () => {
    expect(
      vehiculosPermitidos({ activo: true, hasta: null, producto: 'premium_anual3', vehiculos: NaN }, HOY),
    ).toBe(3);
  });
});
