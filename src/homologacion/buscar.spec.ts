import { describe, expect, it } from 'vitest';
import { buscarHomologacion } from './buscar.js';
import type { Homologacion } from './nomina.js';

function fila(extra: Partial<Homologacion>): Homologacion {
  return {
    marca: 'Suzuki',
    modelo: 'Swift 1,2 Lts. DOHC Hatchback 5P. T/M Motor Otto',
    transmision: 'M',
    combustible: 'Gasolina',
    cilindrada: '1.2',
    carroceria: 'Hatchback',
    codigo: 'SZ5296E40713S',
    certificado: 'C.H. 3507',
    fecha: '3-Sep-13',
    norma: 'Euro 5',
    ...extra,
  };
}

const NOMINA: Homologacion[] = [
  fila({}),
  fila({ modelo: 'Swift 1,2 Lts. DOHC Hatchback 5P. T/A Motor Otto', transmision: 'A', codigo: 'SZ5297E40713S' }),
  fila({ modelo: 'Swift GLX 1,2 Lts. DOHC Sedán 4P. T/A Motor Otto', codigo: 'SZ9999E40713S', fecha: '10-May-24' }),
  fila({ marca: 'Suzuki', modelo: 'Baleno 1,4 Lts. DOHC Hatchback 5P. T/M Motor Otto', codigo: 'SZ1111E40713S' }),
  fila({ marca: 'Volkswagen', modelo: 'Tiguan 1,4 Lts. TSI Station Wagon 5P. T/A Motor Otto', codigo: 'VW2222E40713S' }),
];

describe('buscarHomologacion', () => {
  it('encuentra el modelo de la marca pedida', () => {
    const r = buscarHomologacion(NOMINA, { marca: 'SUZUKI', modelo: 'SWIFT' });

    expect(r.length).toBeGreaterThan(0);
    expect(r.every((f) => f.marca === 'Suzuki')).toBe(true);
    expect(r.every((f) => f.modelo.includes('Swift'))).toBe(true);
  });

  it('no mezcla modelos distintos de la misma marca', () => {
    const r = buscarHomologacion(NOMINA, { marca: 'SUZUKI', modelo: 'SWIFT' });

    expect(r.some((f) => f.modelo.includes('Baleno'))).toBe(false);
  });

  it('no devuelve nada de otra marca', () => {
    const r = buscarHomologacion(NOMINA, { marca: 'VOLKSWAGEN', modelo: 'TIGUAN' });

    expect(r).toHaveLength(1);
    expect(r[0].codigo).toBe('VW2222E40713S');
  });

  it('una marca escrita a medias igual calza', () => {
    expect(buscarHomologacion(NOMINA, { marca: 'VW', modelo: 'TIGUAN' })).toHaveLength(0);
    expect(buscarHomologacion(NOMINA, { marca: 'Volkswagen AG', modelo: 'TIGUAN' })).toHaveLength(1);
  });

  it('la versión exacta queda primera', () => {
    const r = buscarHomologacion(NOMINA, { marca: 'SUZUKI', modelo: 'SWIFT GLX' });

    expect(r[0].codigo).toBe('SZ9999E40713S');
  });

  it('GL no se confunde con GLX: se comparan palabras completas', () => {
    const conGl = [...NOMINA, fila({ modelo: 'Swift GL 1,2 Lts. DOHC Sedán 4P. T/M Motor Otto', codigo: 'SZ8888E40713S' })];
    const r = buscarHomologacion(conGl, { marca: 'SUZUKI', modelo: 'SWIFT GL' });

    expect(r[0].codigo).toBe('SZ8888E40713S');
  });

  it('descarta las homologadas después del año del vehículo', () => {
    const r = buscarHomologacion(NOMINA, { marca: 'SUZUKI', modelo: 'SWIFT', anio: 2015 });

    expect(r.some((f) => f.codigo === 'SZ9999E40713S')).toBe(false);
  });

  it('un modelo homologado años antes sigue valiendo', () => {
    // Un Swift 2024 puede estar certificado desde 2013: la fecha es del modelo.
    const r = buscarHomologacion(NOMINA, { marca: 'SUZUKI', modelo: 'SWIFT', anio: 2024 });

    expect(r.some((f) => f.codigo === 'SZ5296E40713S')).toBe(true);
  });

  it('si el año deja fuera a todas, devuelve igual en vez de nada', () => {
    const r = buscarHomologacion(NOMINA, { marca: 'SUZUKI', modelo: 'SWIFT', anio: 2005 });

    expect(r.length).toBeGreaterThan(0);
  });

  it('entre dos que calzan igual, gana el que arrastra menos palabras de más', () => {
    // Buscando "YARIS", un GR Yaris es otro auto: se nota en todo lo que trae
    // encima y que nadie pidió.
    const toyota = [
      fila({ marca: 'Toyota', modelo: 'GR Yaris 1.6 Turbo AWD 6MT', codigo: 'TY-GR' }),
      fila({ marca: 'Toyota', modelo: 'Yaris SD 1.5 HEV', codigo: 'TY-SD' }),
    ];

    expect(buscarHomologacion(toyota, { marca: 'TOYOTA', modelo: 'YARIS' })[0].codigo).toBe('TY-SD');
  });

  it('la cilindrada no puede arrastrar otro modelo de la misma marca', () => {
    // Un Polo 1,4 y un Tiguan 1,4 comparten el motor y nada más.
    const vw = [
      fila({ marca: 'Volkswagen', modelo: 'Polo 1,4 Lts. Hatchback 5P. T/A', codigo: 'VW-POLO' }),
      fila({ marca: 'Volkswagen', modelo: 'Tiguan 1,4 Lts. TSI Station Wagon 5P. T/M', codigo: 'VW-TIG' }),
    ];
    const r = buscarHomologacion(vw, { marca: 'VOLKSWAGEN', modelo: 'TIGUAN 1.4' });

    expect(r).toHaveLength(1);
    expect(r[0].codigo).toBe('VW-TIG');
  });

  it('un modelo que no existe no devuelve otro cualquiera', () => {
    expect(buscarHomologacion(NOMINA, { marca: 'SUZUKI', modelo: 'VITARA' })).toHaveLength(0);
  });

  it('sin marca no busca nada', () => {
    expect(buscarHomologacion(NOMINA, { marca: '', modelo: 'SWIFT' })).toHaveLength(0);
  });
});
