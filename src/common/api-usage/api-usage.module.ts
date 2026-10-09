import { Global, Injectable, Logger, Module, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { DiscoveryModule, DiscoveryService } from '@nestjs/core';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import axios from 'axios';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { getRuntimeJwtSecret } from '../../modules/auth/jwt-secret.util';
import { extractAccessTokenFromCookie } from '../../modules/auth/cookie-auth.service';
import { setUsageSink, setUserResolver, trackAiUsage, trackFetchUsage, untrackFetchUsage, UsageRow } from './api-usage-tracking';

/**
 * Gắn chốt ghi chi phí vào MỌI bản axios của BE khi app đã khởi động xong:
 * - bản mặc định (`import axios from 'axios'`) mà các module cào kênh dùng để gọi AI;
 * - bản riêng của từng HttpModule.register(...) (vd ai-integration) — bản này được tạo ngay lúc
 *   import module nên không thể chặn trước, phải dò HttpService sau khi DI xong;
 * - `fetch` toàn cục (vd tracked-channels gọi AI bằng fetch).
 */
@Injectable()
export class ApiUsageRecorder implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ApiUsageRecorder.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly discovery: DiscoveryService,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap(): void {
    setUsageSink((rows) => this.save(rows));
    setUserResolver(this.userFromToken());
    trackAiUsage(axios);
    let instances = 1;
    for (const wrapper of this.discovery.getProviders()) {
      if (wrapper.instance instanceof HttpService) {
        trackAiUsage(wrapper.instance.axiosRef);
        instances += 1;
      }
    }
    trackFetchUsage();
    this.logger.log(`Ghi chi phí TikHub/Gemini cho mọi lượt gọi AI (${instances} bản axios + fetch)`);
  }

  onModuleDestroy(): void {
    setUsageSink(null);
    setUserResolver(null);
    untrackFetchUsage();
  }

  /** Người dùng trong token (cookie đăng nhập hoặc Bearer) — cùng nguồn và cùng khoá với JwtStrategy. */
  private userFromToken(): (req: Request) => string | null {
    const jwt = new JwtService({ secret: getRuntimeJwtSecret(this.config) });
    return (req) => {
      const bearer = /^Bearer (.+)$/.exec(String(req.headers?.authorization || ''))?.[1];
      const token = extractAccessTokenFromCookie(req) ?? bearer;
      if (!token) return null;
      try {
        const payload: any = jwt.verify(token);
        return typeof payload?.sub === 'string' ? payload.sub : null;
      } catch {
        return null; // token hỏng/hết hạn → không gán cho ai
      }
    };
  }

  /** Lỗi ghi chỉ log lại — không bao giờ làm hỏng luồng chính. */
  async save(rows: UsageRow[]): Promise<void> {
    if (!rows.length) return;
    try {
      await this.prisma.apiUsageLog.createMany({ data: rows });
    } catch (err: any) {
      this.logger.warn(`Không ghi được chi phí API: ${err?.message}`);
    }
  }
}

@Global()
@Module({
  imports: [DiscoveryModule],
  providers: [ApiUsageRecorder],
})
export class ApiUsageModule {}
