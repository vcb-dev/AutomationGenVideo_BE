import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SearchRecommendationService } from './search-recommendations.service';
import { SearchRecommendationController } from './search-recommendations.controller';

@Module({
    imports: [ConfigModule],
    controllers: [SearchRecommendationController],
    providers: [SearchRecommendationService],
    exports: [SearchRecommendationService],
})
export class SearchRecommendationModule { }
