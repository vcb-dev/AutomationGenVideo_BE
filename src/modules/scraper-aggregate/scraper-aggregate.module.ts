import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { ScraperAggregateController } from './scraper-aggregate.controller';
import { ScraperAggregateReadService } from './scraper-aggregate-read.service';

@Module({
  imports: [PrismaModule],
  controllers: [ScraperAggregateController],
  providers: [ScraperAggregateReadService],
})
export class ScraperAggregateModule {}
