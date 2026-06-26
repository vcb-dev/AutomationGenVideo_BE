import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import helmet from 'helmet';
import * as compression from 'compression';
import { AppModule } from "./app.module";

// Fix BigInt serialization for JSON
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: process.env.NODE_ENV === 'production'
      ? ['error', 'warn', 'log']
      : ['error', 'warn', 'log', 'debug'],
  });

  // Security and Optimization
  app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }));
  app.use(compression({
    level: 6,
    threshold: 1024,
    filter: (req, res) => {
      if (req.url.startsWith('/api/social/media/')) return false;
      return compression.filter(req, res);
    },
  }));

  const expressInstance = app.getHttpAdapter().getInstance();
  if (typeof expressInstance.set === "function") {
    expressInstance.set("trust proxy", true);
  }

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Set global prefix
  app.setGlobalPrefix('api');

  // Rewrite /auth/google/callback and /social/oauth/ callbacks to prepend /api
  // This avoids redirect_uri_mismatch errors and 404s in Google/Social Cloud Console
  app.use((req, res, next) => {
    if (req.url.startsWith('/auth/google/callback')) {
      req.url = req.url.replace('/auth/google/callback', '/api/auth/google/callback');
    } else if (req.url.startsWith('/social/oauth/')) {
      req.url = req.url.replace('/social/oauth/', '/api/social/oauth/');
    }
    next();
  });

  // CORS configuration
  // Build the allowed-origin set from CORS_ORIGIN, then auto-add www. / non-www variants
  // so that vcbi.vn and www.vcbi.vn both work without manual duplication in env vars.
  const rawOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map(o => o.trim()).filter(Boolean)
    : [];

  let corsOriginOption: string | string[] | ((origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => void) = '*';
  if (rawOrigins.length > 0) {
    const allowedSet = new Set<string>(rawOrigins);
    for (const o of rawOrigins) {
      try {
        const u = new URL(o);
        if (u.hostname.startsWith('www.')) {
          allowedSet.add(`${u.protocol}//${u.hostname.slice(4)}${u.port ? ':' + u.port : ''}`);
        } else {
          allowedSet.add(`${u.protocol}//www.${u.hostname}${u.port ? ':' + u.port : ''}`);
        }
      } catch { /* invalid URL, skip */ }
    }
    corsOriginOption = (origin, callback) => {
      // Allow server-to-server (no origin), matching origins, và mọi extension Chrome
      // (chrome-extension://... — client nội bộ, API đã được bảo vệ bằng JWT).
      if (!origin || allowedSet.has(origin) || origin.startsWith('chrome-extension://')) {
        return callback(null, true);
      }
      callback(new Error(`CORS: origin '${origin}' not allowed`));
    };
  }

  app.enableCors({
    origin: corsOriginOption,
    credentials: true,
  });

  // Swagger documentation
  const config = new DocumentBuilder()
    .setTitle("Video Production API")
    .setDescription(
      "API for automated video production system with authentication and role-based access control",
    )
    .setVersion("1.0")
    .addBearerAuth()
    .addTag("auth", "Authentication endpoints")
    .addTag("users", "User management endpoints")
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("api", app, document);

  // Graceful shutdown support
  app.enableShutdownHooks();

  const port = process.env.PORT || 3000;
  await app.listen(port);

  expressInstance.keepAliveTimeout  = 65_000;
  expressInstance.headersTimeout    = 66_000;
  expressInstance.maxHeadersCount   = 100;
  expressInstance.timeout           = 120_000; // 2 min max request time (heavy Lark queries)

  console.log(`Application is running on: http://localhost:${port}`);
  console.log(`Swagger documentation: http://localhost:${port}/api`);
}

bootstrap();
