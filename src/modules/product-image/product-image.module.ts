import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { getRuntimeJwtSecret } from '../auth/jwt-secret.util';
import { ProductImageController } from './product-image.controller';
import { ProductImageService } from './product-image.service';
import { ProductImageGenerationsService } from './product-image-generations.service';

@Module({
  imports: [
    // Mỗi lệnh gọi AI tự truyền timeout riêng (ProductImageService.*_TIMEOUT_MS).
    HttpModule.register({ maxRedirects: 5 }),
    // Ký token theo người bấm để gọi AI service — chung JWT_SECRET với AI như các module
    // youtube-scraper/kuaishou-scraper.
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: getRuntimeJwtSecret(configService),
        signOptions: { expiresIn: '10m' },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [ProductImageController],
  providers: [ProductImageService, ProductImageGenerationsService],
})
export class ProductImageModule {}
