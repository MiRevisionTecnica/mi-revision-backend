import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const logger = new Logger('Bootstrap');

  app.setGlobalPrefix('api', { exclude: ['health'] });

  // `contentSecurityPolicy` desactivado porque Swagger UI carga estilos propios.
  app.use(helmet({ contentSecurityPolicy: false }));

  const origins = process.env.CORS_ORIGINS ?? '*';
  app.enableCors({
    origin: origins === '*' ? true : origins.split(',').map((value) => value.trim()),
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  app.enableShutdownHooks();

  const config = new DocumentBuilder()
    .setTitle('Mi Revisión Técnica — API')
    .setDescription(
      [
        'API de la app **Mi Revisión Técnica** (Fase 1).',
        '',
        'Controla los vencimientos de revisión técnica, SOAP y permiso de circulación,',
        'envía los recordatorios por push y correo, y expone el catálogo de plantas PRT',
        'de la Región Metropolitana.',
        '',
        '**Autenticación:** `POST /api/auth/login` entrega un `accessToken`. Úsalo con el',
        'botón *Authorize* de esta página o en el header `Authorization: Bearer <token>`.',
      ].join('\n'),
    )
    .setVersion('1.0.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'access-token',
    )
    .addTag('Autenticación', 'Registro, inicio de sesión y perfil')
    .addTag('Vehículos', 'Vehículo del usuario y sus fechas de vencimiento')
    .addTag('Documentos', 'Archivos asociados a un vehículo')
    .addTag('Plantas PRT', 'Catálogo público de plantas de revisión técnica')
    .addTag('Dispositivos', 'Tokens de push de Expo')
    .addTag('Recordatorios', 'Avisos de vencimiento')
    .addTag('Estado', 'Health check')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document, {
    customSiteTitle: 'Mi Revisión Técnica — API',
    swaggerOptions: { persistAuthorization: true },
    jsonDocumentUrl: 'docs/json',
  });

  const port = Number(process.env.PORT ?? 3000);
  // '0.0.0.0' es obligatorio en Railway: escuchar solo en localhost deja el
  // contenedor sin tráfico entrante.
  await app.listen(port, '0.0.0.0');

  logger.log(`API escuchando en el puerto ${port}`);
  logger.log(`Documentación en /docs`);
}

await bootstrap();
