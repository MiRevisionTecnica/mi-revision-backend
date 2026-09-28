import { describe, expect, it } from 'vitest';
import { anticipacionesDe, diasAConsultar, esAnticipacionValida } from './anticipacion.js';
import type { UserDoc } from '../firebase/collections.js';

const POR_DEFECTO = [30, 15, 7, 1, 0];

function cuenta(extra: Partial<UserDoc>): UserDoc {
  return {
    email: 'alguien@ejemplo.cl',
    name: 'Alguien',
    googleId: null,
    photoUrl: null,
    providers: ['password'],
    emailReminders: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...extra,
  } as UserDoc;
}

describe('anticipacionesDe', () => {
  it('sin elección, usa los días del servidor', () => {
    expect(anticipacionesDe(cuenta({}), POR_DEFECTO)).toEqual(POR_DEFECTO);
  });

  it('con plan vigente, respeta los días elegidos y los ordena', () => {
    const user = cuenta({
      reminderOffsets: [7, 45, 0],
      plan: { activo: true, hasta: null },
    });

    expect(anticipacionesDe(user, POR_DEFECTO)).toEqual([45, 7, 0]);
  });

  it('sin plan vigente vuelve a los del servidor, no se queda sin avisos', () => {
    const user = cuenta({
      reminderOffsets: [45],
      plan: { activo: true, hasta: '2020-01-01T00:00:00.000Z' },
    });

    expect(anticipacionesDe(user, POR_DEFECTO)).toEqual(POR_DEFECTO);
  });

  it('descarta días que no están en la lista permitida', () => {
    const user = cuenta({
      reminderOffsets: [30, 99],
      plan: { activo: true, hasta: null },
    });

    expect(anticipacionesDe(user, POR_DEFECTO)).toEqual([30]);
  });
});

describe('diasAConsultar', () => {
  it('incluye los del servidor y todos los elegibles, sin repetir', () => {
    const dias = diasAConsultar(POR_DEFECTO);

    expect(dias).toContain(45);
    expect(dias).toContain(0);
    expect(new Set(dias).size).toBe(dias.length);
    expect([...dias]).toEqual([...dias].sort((a, b) => b - a));
  });
});

describe('esAnticipacionValida', () => {
  it('acepta las de la lista y rechaza el resto', () => {
    expect(esAnticipacionValida(30)).toBe(true);
    expect(esAnticipacionValida(31)).toBe(false);
  });
});
