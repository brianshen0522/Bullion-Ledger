import 'reflect-metadata';
import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe, ClassSerializerInterceptor, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';

import { AppModule } from './app.module.js';
import { HttpExceptionFilter } from './common/filters/http-exception.filter.js';
import { requestIdMiddleware } from './common/middleware/request-id.middleware.js';
import { loadRuntimeConfig } from './config/runtime.config.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    rawBody: true,
  });
  const config = app.get(ConfigService);
  const runtime = loadRuntimeConfig(config);
  const port = Number(config.get<string>('PORT') ?? '3000');
  const apiPrefix = config.get<string>('API_PREFIX') ?? 'api';

  app.setGlobalPrefix(apiPrefix);
  if (runtime.trustedProxyHops > 0) {
    app.getHttpAdapter().getInstance().set('trust proxy', runtime.trustedProxyHops);
  }
  app.use(cookieParser());
  app.use(requestIdMiddleware);
  app.enableCors({
    origin: runtime.webOrigin,
    credentials: true,
    allowedHeaders: [
      'Content-Type',
      'Content-Encoding',
      'Authorization',
      'X-Request-Id',
      'X-Filename',
      'Idempotency-Key',
    ],
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
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));

  await app.listen(port);
  Logger.log(`API listening on :${port}/${apiPrefix}`, 'Bootstrap');
}

bootstrap().catch((err) => {
  console.error('Fatal bootstrap error', err);
  process.exit(1);
});
