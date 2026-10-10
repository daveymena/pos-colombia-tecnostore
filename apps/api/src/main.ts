import 'dotenv/config';
import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  const uploads =
    process.env.UPLOADS_DIR ||
    (process.cwd().endsWith(join('apps', 'api')) ? join(process.cwd(), 'uploads') : join(process.cwd(), 'apps', 'api', 'uploads'));
  if (!existsSync(uploads)) mkdirSync(uploads, { recursive: true });
  app.useStaticAssets(uploads, { prefix: '/uploads/' });
  app.setGlobalPrefix('api');
  const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map(v => v.trim()).filter(Boolean);
  app.enableCors({ origin: allowedOrigins, credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
  const config = new DocumentBuilder().setTitle('POS Colombia API').setDescription('API del sistema POS').setVersion('1.0').addBearerAuth().build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));
  await app.listen(process.env.PORT || 3000);
}
bootstrap();
