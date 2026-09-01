import 'reflect-metadata';

import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module';
import { APP_CONFIG, type AppConfig } from './config/configuration';
import { buildSwaggerConfig } from './swagger.config';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const config = app.get<AppConfig>(APP_CONFIG);
  const logger = new Logger('Bootstrap');

  app.setGlobalPrefix(config.globalPrefix);

  app.enableCors({
    origin: config.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  // OpenAPI is the contract acne-web generates its typed client from (section 4).
  const document = SwaggerModule.createDocument(app, buildSwaggerConfig(new DocumentBuilder()));
  SwaggerModule.setup('docs', app, document, {
    customSiteTitle: 'acne-api · Diagnóstico asistido de acné (UNT 2026)',
    swaggerOptions: { persistAuthorization: true },
  });

  // Served at a stable, prefix-free path so `openapi-typescript` and CI can fetch it directly.
  app.getHttpAdapter().get('/openapi.json', (_request: unknown, response: { json: (body: unknown) => void }) => {
    response.json(document);
  });

  await app.listen(config.port, '0.0.0.0');

  logger.log(`acne-api escuchando en http://localhost:${config.port}/${config.globalPrefix}`);
  logger.log(`Swagger UI: http://localhost:${config.port}/docs`);
  logger.log(`OpenAPI: http://localhost:${config.port}/openapi.json`);
  logger.log(
    `Almacenamiento=${config.storage.driver} · Cola=${config.queue.driver} · Motor de IA=${config.aiEngine.url}`,
  );
}

void bootstrap();
