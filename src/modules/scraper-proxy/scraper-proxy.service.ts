import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosRequestConfig } from 'axios';
import { Request, Response } from 'express';

// FE gọi /api/scraper/* và /api/facebook/* — trước đây gọi thẳng sang AI, giờ
// đi qua BE trước rồi mới relay sang AI (đúng luồng FE → BE → AI). AI tự xác thực
// lại JWT bằng NestJWTAuthentication (chung JWT_SECRET với BE) nên chỉ cần forward
// nguyên header Authorization, không cần thêm guard ở lớp proxy này.
@Injectable()
export class ScraperProxyService {
  private readonly logger = new Logger(ScraperProxyService.name);
  private readonly aiServiceUrl = (process.env.AI_SERVICE_URL || 'http://localhost:8000').replace(/\/$/, '');

  async forward(req: Request, res: Response): Promise<void> {
    const targetUrl = `${this.aiServiceUrl}${req.originalUrl}`;
    const method = req.method.toUpperCase();

    const config: AxiosRequestConfig = {
      method,
      url: targetUrl,
      headers: {
        Authorization: req.headers['authorization'] || '',
        'Content-Type': 'application/json',
      },
      data: method === 'GET' || method === 'HEAD' ? undefined : req.body,
      timeout: 120_000,
      validateStatus: () => true,
    };

    try {
      const aiRes = await axios.request(config);
      res.status(aiRes.status).json(aiRes.data);
    } catch (err: any) {
      this.logger.error(`[ScraperProxy] ${method} ${targetUrl} failed: ${err.message}`);
      res.status(502).json({ error: 'AI service không phản hồi' });
    }
  }
}
