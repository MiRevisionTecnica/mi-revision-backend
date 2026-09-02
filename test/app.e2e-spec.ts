import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';

/**
 * Prueba de humo: requiere credenciales de Firebase válidas en el entorno.
 * Se ejecuta con `npm run test:e2e`.
 */
describe('API (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api', { exclude: ['health'] });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET /health responde el estado del servicio', async () => {
    const response = await request(app.getHttpServer()).get('/health').expect(200);
    expect(response.body).toMatchObject({ firestore: 'ok' });
  });

  it('GET /api/vehicles exige token', async () => {
    await request(app.getHttpServer()).get('/api/vehicles').expect(401);
  });

  it('GET /api/plants/comunas es público', async () => {
    const response = await request(app.getHttpServer()).get('/api/plants/comunas').expect(200);
    expect(Array.isArray(response.body)).toBe(true);
  });
});
