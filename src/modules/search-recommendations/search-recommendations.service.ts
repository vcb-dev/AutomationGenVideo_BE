import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MeiliSearch } from 'meilisearch';
import Redis from 'ioredis';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface SearchRecord {
    term: string;
    count: number;
    lastSearchedAt: number;
}

@Injectable()
export class SearchRecommendationService implements OnModuleInit {
    private readonly logger = new Logger(SearchRecommendationService.name);
    private meilisearchClient: MeiliSearch;
    private redisClient: Redis;
    private readonly INDEX_NAME = 'search_recommendations';
    private readonly STOP_WORDS = [
        'the', 'a', 'an', 'in', 'on', 'at', 'for', 'to', 'of', 'and', 'or', 'but', // English
        'là', 'và', 'của', 'những', 'cái', 'việc', 'trong', 'khi', 'bị', 'được', // Vietnamese (basic)
        'http', 'https', 'www', '.com' // URL parts
    ];

    constructor(
        private configService: ConfigService,
        private prisma: PrismaService
    ) {
        // Initialize Meilisearch
        const meiliHost = this.configService.get<string>('MEILISEARCH_HOST') || 'http://localhost:7700';
        const meiliKey = this.configService.get<string>('MEILISEARCH_API_KEY') || 'masterKey';

        this.meilisearchClient = new MeiliSearch({
            host: meiliHost,
            apiKey: meiliKey,
        });

        // Initialize Redis
        const redisHost = this.configService.get<string>('REDIS_HOST') || 'localhost';
        const redisPort = this.configService.get<number>('REDIS_PORT') || 6379;

        this.redisClient = new Redis({
            host: redisHost,
            port: redisPort,
        });
    }

    async onModuleInit() {
        await this.ensureIndex();
    }

    private async ensureIndex() {
        try {
            const index = this.meilisearchClient.index(this.INDEX_NAME);

            // Check if index exists, create if not (Meilisearch creates on first document add, but we configure settings)
            // We'll update settings regardless
            await index.updateSettings({
                searchableAttributes: ['term'],
                filterableAttributes: ['count'],
                sortableAttributes: ['count', 'lastSearchedAt'],
                rankingRules: [
                    'words',
                    'typo',
                    'proximity',
                    'attribute',
                    'sort',
                    'exactness',
                    'count:desc' // Custom rule: prioritize high frequency
                ],
                stopWords: this.STOP_WORDS,
            });

            this.logger.log('Meilisearch index configured successfully');
        } catch (error) {
            this.logger.error('Failed to configure Meilisearch index', error);
        }
    }

    /**
     * Record a successful search term
     */
    async recordSearch(term: string, userId: string = null): Promise<void> {
        if (!term || term.trim().length < 2) return;

        const normalizedTerm = term.trim().toLowerCase();

        // Simple filter for sensitive words could go here
        if (this.STOP_WORDS.includes(normalizedTerm)) return;

        // --- STEP A: AUDIT LOG (Log to DB) ---
        if (userId) {
            try {
                await this.prisma.searchHistory.create({
                    data: {
                        user_id: userId,
                        term: normalizedTerm,
                        timestamp: new Date()
                    }
                });
            } catch (dbError) {
                this.logger.error(`Failed to log search history for user ${userId}`, dbError);
            }
        }

        try {
            const index = this.meilisearchClient.index(this.INDEX_NAME);

            // Check existing document
            // Note: Meilisearch uses 'id' as primary key. We'll generate a consistent ID from the term.
            // Base64 encoding the term to make it safe for URL/ID
            const id = Buffer.from(normalizedTerm).toString('base64').replace(/=/g, '');

            let count = 1;
            try {
                const existing = await index.getDocument(id);
                if (existing) {
                    count = (existing.count as number) + 1;
                }
            } catch (e) {
                // Document doesn't exist yet, count remains 1
            }

            await index.addDocuments([{
                id: id,
                term: normalizedTerm,
                count: count,
                lastSearchedAt: Date.now()
            }]);

            // Invalidate cache ONLY if it's a new high-frequency term (optimization: naive invalidation for now)
            // Real-world: debounce or only invalidate specific prefixes.
            // For simplicity/requirement: we won't invalidate EVERYTHING, but we rely on Redis TTL.
        } catch (error) {
            this.logger.error(`Failed to record search term: ${term}`, error);
        }
    }

    async getSearchHistory(limit: number = 50) {
        return this.prisma.searchHistory.findMany({
            take: limit,
            orderBy: { timestamp: 'desc' },
            include: {
                user: {
                    select: {
                        id: true,
                        email: true,
                        full_name: true,
                        role: true
                    }
                }
            }
        });
    }

    /**
     * Get suggestions for a prefix
     */
    async getSuggestions(query: string): Promise<string[]> {
        if (!query || query.trim().length === 0) return [];

        const normalizedQuery = query.trim().toLowerCase();
        const cacheKey = `search_suggestions:${normalizedQuery}`;

        // 1. Check Redis Cache
        try {
            const cached = await this.redisClient.get(cacheKey);
            if (cached) {
                return JSON.parse(cached);
            }
        } catch (error) {
            this.logger.warn('Redis cache error', error);
        }

        // 2. Query Meilisearch
        try {
            const index = this.meilisearchClient.index(this.INDEX_NAME);
            const searchResponse = await index.search(normalizedQuery, {
                limit: 10,
                attributesToRetrieve: ['term'],
                showMatchesPosition: false
            });

            const suggestions = searchResponse.hits.map((hit: any) => hit.term);

            // 3. Save to Redis Cache (TTL: 5 minutes)
            if (suggestions.length > 0) {
                await this.redisClient.setex(cacheKey, 300, JSON.stringify(suggestions));
            }

            return suggestions;
        } catch (error) {
            this.logger.error('Meilisearch query failed', error);
            return [];
        }
    }
}
