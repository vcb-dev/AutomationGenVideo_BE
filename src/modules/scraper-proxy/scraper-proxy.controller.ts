import { All, Controller, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { ScraperProxyService } from './scraper-proxy.service';

@Controller()
export class ScraperProxyController {
  constructor(private readonly proxy: ScraperProxyService) {}

  @All('scraper/*')
  async proxyScraper(@Req() req: Request, @Res() res: Response) {
    return this.proxy.forward(req, res);
  }

  @All('facebook/*')
  async proxyFacebook(@Req() req: Request, @Res() res: Response) {
    return this.proxy.forward(req, res);
  }
}
