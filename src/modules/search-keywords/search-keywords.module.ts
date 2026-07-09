import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { SearchKeywordsController } from './search-keywords.controller';
import { SearchKeywordsService } from './search-keywords.service';

@Module({
  imports: [PrismaModule],
  controllers: [SearchKeywordsController],
  providers: [SearchKeywordsService],
})
export class SearchKeywordsModule {}
