import { Module } from '@nestjs/common';
import { ScraperProxyController } from './scraper-proxy.controller';
import { ScraperProxyService } from './scraper-proxy.service';

@Module({
  controllers: [ScraperProxyController],
  providers: [ScraperProxyService],
})
export class ScraperProxyModule {}
