import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // API traffic reaches the container only through the single Caddy proxy.
  app.getHttpAdapter().getInstance().set("trust proxy", 1);
  const configuredOrigins = new Set(
    (process.env.WEB_ORIGIN ?? 'http://localhost:3000')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
  const siteDomain = process.env.SITE_DOMAIN?.trim();
  if (siteDomain) {
    configuredOrigins.add(`https://${siteDomain}`);
    configuredOrigins.add(`http://${siteDomain}`);
  }
  const localPreviewOrigins = new Set(['http://localhost:3000', 'http://127.0.0.1:3000']);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );
  app.enableCors({
    origin: (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) => {
      if (!origin || configuredOrigins.has(origin) || localPreviewOrigins.has(origin)) {
        callback(null, true);
        return;
      }

      callback(null, false);
    },
    credentials: true,
  });

  const port = Number(process.env.API_PORT ?? 3001);
  await app.listen(port);
}

void bootstrap();
