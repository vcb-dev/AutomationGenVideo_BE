process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // force compile trigger
import { NestFactory, HttpAdapterHost } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import helmet from 'helmet';
import * as compression from 'compression';
import * as cookieParser from 'cookie-parser';
import { json, urlencoded } from 'express';
import { AppModule } from "./app.module";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";
import { initSocialSyncCron } from './social-sync.scheduler';

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

  // Express body-parser mặc định giới hạn 100kb — không đủ cho system_prompt dài (~30-60KB
  // thô, cộng thêm overhead escape ký tự đặc biệt khi encode JSON). Nâng lên 2mb để có dư
  // nhiều lần, tránh lỗi "PayloadTooLargeError" khi admin lưu prompt dài qua CRUD nhân vật.
  app.use(json({ limit: '2mb' }));
  app.use(urlencoded({ limit: '2mb', extended: true }));

  // Phải đứng trước mọi guard/strategy đọc req.cookies — không có nó thì req.cookies là undefined
  // và toàn bộ auth bằng cookie im lặng trượt về Bearer, rất khó lần ra khi debug.
  app.use(cookieParser());

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
    expressInstance.set("etag", false);
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

  // Global exception filter
  const httpAdapterHost = app.get(HttpAdapterHost);
  app.useGlobalFilters(new AllExceptionsFilter(httpAdapterHost));

  // Rewrite /auth/google/callback and /social/oauth/ callbacks to prepend /api
  // This avoids redirect_uri_mismatch errors and 404s in Google/Social Cloud Console
  app.use((req, res, next) => {
    console.log(`[HTTP Request] ${req.method} ${req.url}`);
    res.on('finish', () => {
      console.log(`[HTTP Response] ${req.method} ${req.url} -> Status ${res.statusCode}`);
    });

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
      // Allow server-to-server (no origin), matching origins, and Chrome extensions
      // (chrome-extension://... — internal client, API is protected by JWT).
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

  // Kích hoạt cron sync social_video_report + ads_campaign_stats (01:00 AM hàng ngày)
  initSocialSyncCron();

  console.log(`Application is running on: http://localhost:${port}`);
  console.log(`Swagger documentation: http://localhost:${port}/api`);
}

bootstrap();
