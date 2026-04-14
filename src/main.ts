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
  app.use(compression({ level: 6, threshold: 1024 }));

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

  // Rewrite /auth/google/callback to /api/auth/google/callback
  // This avoids redirect_uri_mismatch errors in Google Cloud Console
  // if the whitelisted URL doesn't have the /api/ prefix.
  app.use((req, res, next) => {
    if (req.url.startsWith('/auth/google/callback')) {
      req.url = req.url.replace('/auth/google/callback', '/api/auth/google/callback');
    }
    next();
  });

  // CORS configuration
  // Browser does not allow `Access-Control-Allow-Origin: *` together with credentials=true.
  // Keep wildcard open, but disable credentials in that case.
  const corsOrigin = process.env.CORS_ORIGIN || "*";
  app.enableCors({
    origin: corsOrigin,
    credentials: corsOrigin !== "*",
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
