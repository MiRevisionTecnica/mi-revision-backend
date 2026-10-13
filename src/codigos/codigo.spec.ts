import { describe, expect, it } from 'vitest';
import {
  generarCodigo,
  normalizarCodigo,
  problemaAlCanjear,
  problemaAlCrear,
  vigenciaDelRegalo,
  type Codigo,
} from './codigo.js';

const HOY = new Date('2026-10-13T12:00:00Z');

function codigo(extra: Partial<Codigo> = {}): Codigo {
  return {
    codigo: 'PREM7K3H9DQ2',
    tipo: 'personal',
    meses: 3,
    vehiculos: 1,
    usosMaximos: 10,
    usados: 0,
    expiraEl: null,
    activo: true,
    creadoEl: '2026-10-01T00:00:00.000Z',
    ...extra,
  };
}

describe('generarCodigo', () => {
  it('no usa caracteres que se confunden al dictarlos', () => {
    // Estos códigos se leen por teléfono y se copian de un papel.
    for (let i = 0; i < 200; i++) {
      expect(generarCodigo()).not.toMatch(/[O0I1L]/);
    }
  });

  it('no repite', () => {
    const vistos = new Set(Array.from({ length: 500 }, () => generarCodigo()));
    expect(vistos.size).toBe(500);
  });
});

describe('normalizarCodigo', () => {
  it('da igual cómo lo escriba la persona', () => {
    expect(normalizarCodigo('prem-7k3h-9dq2')).toBe('PREM7K3H9DQ2');
    expect(normalizarCodigo('PREM 7K3H 9DQ2')).toBe('PREM7K3H9DQ2');
    expect(normalizarCodigo('  PREM7K3H9DQ2 ')).toBe('PREM7K3H9DQ2');
  });
});

describe('problemaAlCanjear', () => {
  it('un código bueno se puede canjear', () => {
    expect(problemaAlCanjear(codigo(), 'u1', [], HOY)).toBeNull();
  });

  it('distingue cada motivo, porque cada uno merece otro mensaje', () => {
    expect(problemaAlCanjear(null, 'u1', [], HOY)).toBe('no-existe');
    expect(problemaAlCanjear(codigo({ activo: false }), 'u1', [], HOY)).toBe('desactivado');
    expect(problemaAlCanjear(codigo({ expiraEl: '2026-01-01T00:00:00Z' }), 'u1', [], HOY)).toBe('expirado');
    expect(problemaAlCanjear(codigo({ usados: 10 }), 'u1', [], HOY)).toBe('agotado');
    expect(problemaAlCanjear(codigo(), 'u1', ['u1'], HOY)).toBe('ya-canjeado');
  });

  it('nadie lo canjea dos veces, aunque queden usos', () => {
    expect(problemaAlCanjear(codigo({ usosMaximos: 100, usados: 1 }), 'u1', ['u1'], HOY)).toBe('ya-canjeado');
  });

  it('que otro lo haya canjeado no estorba', () => {
    expect(problemaAlCanjear(codigo({ usados: 1 }), 'u2', ['u1'], HOY)).toBeNull();
  });
});

describe('vigenciaDelRegalo', () => {
  it('desde hoy cuando no había nada', () => {
    expect(vigenciaDelRegalo(3, null, HOY)).toBe(new Date('2027-01-13T12:00:00Z').toISOString());
  });

  it('se suma al regalo que ya tenía, no lo reemplaza', () => {
    // Dos códigos de tres meses son seis, no tres.
    const primero = vigenciaDelRegalo(3, null, HOY);
    expect(vigenciaDelRegalo(3, primero, HOY)).toBe(new Date('2027-04-13T12:00:00Z').toISOString());
  });

  it('sumar meses no se corre una hora con el cambio de horario', () => {
    // Chile cambia de huso dos veces al año. En hora local, tres meses movían
    // el vencimiento una hora.
    expect(vigenciaDelRegalo(3, null, new Date('2026-03-01T12:00:00Z'))).toBe(
      '2026-06-01T12:00:00.000Z',
    );
  });

  it('un mes después del 31 de enero es el 28 de febrero, no el 3 de marzo', () => {
    expect(vigenciaDelRegalo(1, null, new Date('2026-01-31T12:00:00Z'))).toBe(
      '2026-02-28T12:00:00.000Z',
    );
  });

  it('un regalo ya vencido no arrastra: se cuenta desde hoy', () => {
    expect(vigenciaDelRegalo(1, '2026-01-01T00:00:00Z', HOY)).toBe(
      new Date('2026-11-13T12:00:00Z').toISOString(),
    );
  });
});

describe('problemaAlCrear', () => {
  const base = { tipo: 'personal' as const, meses: 3, vehiculos: 1, usosMaximos: 1, expiraEl: null };

  it('acepta lo razonable', () => {
    expect(problemaAlCrear(base)).toBeNull();
    expect(problemaAlCrear({ ...base, meses: 12 })).toBeNull();
    expect(problemaAlCrear({ ...base, tipo: 'flotilla', vehiculos: 25 })).toBeNull();
  });

  it('no deja pasar de un año', () => {
    expect(problemaAlCrear({ ...base, meses: 13 })).toContain('1 a 12');
    expect(problemaAlCrear({ ...base, meses: 0 })).toContain('1 a 12');
  });

  it('un código personal no puede dar más de tres vehículos', () => {
    expect(problemaAlCrear({ ...base, vehiculos: 4 })).toContain('flotilla');
  });

  it('una flotilla no puede dar tres o menos: para eso está el personal', () => {
    expect(problemaAlCrear({ ...base, tipo: 'flotilla', vehiculos: 3 })).toContain('personal');
  });

  it('pone un techo para que un dedazo no regale cien vehículos de más', () => {
    expect(problemaAlCrear({ ...base, tipo: 'flotilla', vehiculos: 500 })).toContain('100');
  });

  it('rechaza números que no son números', () => {
    expect(problemaAlCrear({ ...base, meses: 1.5 })).not.toBeNull();
    expect(problemaAlCrear({ ...base, usosMaximos: 0 })).not.toBeNull();
    expect(problemaAlCrear({ ...base, expiraEl: 'mañana' })).toContain('fecha');
  });
});
