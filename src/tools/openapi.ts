/**
 * Genera openapi.json sin levantar la base de datos.
 *
 * Sirve para dos cosas: dejar el contrato versionado (se puede importar en
 * Postman o generar un cliente para la app) y verificar en CI que todos los
 * módulos, controladores y DTOs siguen resolviéndose.
 *
 * Uso: npm run openapi (compila primero: el generador necesita la metadata
 *      de decoradores que emite tsc, no disponible con tsx/esbuild).
 */
process.env.NODE_ENV ??= 'development';
process.env.FIREBASE_PROJECT_ID ??= 'contrato-local';
process.env.FIREBASE_CLIENT_EMAIL ??= 'contrato@local';
process.env.FIREBASE_PRIVATE_KEY ??= 'contrato';
process.env.JWT_SECRET ??= 'solo-para-generar-el-contrato-no-es-un-secreto-real';
process.env.REMINDERS_ENABLED ??= 'false';

const { Test } = await import('@nestjs/testing');
const { DocumentBuilder, SwaggerModule } = await import('@nestjs/swagger');
const { writeFile } = await import('node:fs/promises');
const { AppModule } = await import('../app.module.js');
const { FirebaseService } = await import('../firebase/firebase.service.js');

// Doble de Firebase: el contrato no necesita tocar Firestore.
const firebaseStub = {
  onModuleInit: () => undefined,
  db: {
    collection: () => ({ get: async () => ({ docs: [] }) }),
  },
  ping: async () => true,
};

const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
  .overrideProvider(FirebaseService)
  .useValue(firebaseStub)
  .compile();

const app = moduleRef.createNestApplication();
app.setGlobalPrefix('api', { exclude: ['health'] });
await app.init();

const config = new DocumentBuilder()
  .setTitle('Mi Revisión Técnica — API')
  .setDescription('Contrato generado desde el código. Ver README.md.')
  .setVersion('1.0.0')
  .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'access-token')
  .build();

const document = SwaggerModule.createDocument(app, config);
await writeFile('openapi.json', `${JSON.stringify(document, null, 2)}\n`, 'utf8');

const routes = Object.entries(document.paths).flatMap(([path, methods]) =>
  Object.keys(methods).map((method) => `${method.toUpperCase()} ${path}`),
);

console.log(`openapi.json generado con ${routes.length} endpoints:`);
routes.sort().forEach((route) => console.log(`  ${route}`));

await app.close();
process.exit(0);
