import 'dotenv/config';
import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  const uploads =
    process.env.UPLOADS_DIR ||
    (process.cwd().endsWith(join('apps', 'api')) ? join(process.cwd(), 'uploads') : join(process.cwd(), 'apps', 'api', 'uploads'));
  if (!existsSync(uploads)) mkdirSync(uploads, { recursive: true });
  app.useStaticAssets(uploads, { prefix: '/uploads/' });
  const webDist = process.env.WEB_DIST_DIR || join(process.cwd(), 'apps', 'web', 'dist');
  if (existsSync(webDist)) {
    app.useStaticAssets(webDist, { index: false });
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.method !== 'GET' || req.path === '/api' || req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) return next();
      if (!String(req.headers.accept || '').includes('text/html')) return next();
      res.sendFile(join(webDist, 'index.html'));
    });
  }
  app.setGlobalPrefix('api');
  const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map(v => v.trim()).filter(Boolean);
  app.enableCors({ origin: allowedOrigins, credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
  if (process.env.NODE_ENV !== 'production' || process.env.ENABLE_SWAGGER === 'true') {
    const config = new DocumentBuilder().setTitle('POS Colombia API').setDescription('API del sistema POS').setVersion('1.0').addBearerAuth().build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));
  }
  await app.listen(process.env.PORT || 3000);
}
bootstrap();
