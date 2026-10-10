import 'dotenv/config';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaService } from './prisma.service';
import { AppController } from './app.controller';
import { AppService } from './app.service';

const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || jwtSecret.length < 32) {
  throw new Error('JWT_SECRET debe configurarse con al menos 32 caracteres. Copia .env.example a .env y define un secreto seguro.');
}

@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 120 }]),
    JwtModule.register({ global: true, secret: jwtSecret, signOptions: { expiresIn: '8h' } }),
  ],
  controllers: [AppController],
  providers: [PrismaService, AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
