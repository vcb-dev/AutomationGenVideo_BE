import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { resolveAiServiceUrl } from '../../common/config/ai-service-url';

export interface SuggestionResult {
    suggestions: string[];
    source: string;
}

@Injectable()
export class SearchRecommendationService {
    private readonly logger = new Logger(SearchRecommendationService.name);
    private readonly aiServiceUrl: string;

    // Simple in-memory cache (5 min TTL)
    private cache = new Map<string, { data: SuggestionResult; ts: number }>();
    private readonly CACHE_TTL = 5 * 60 * 1000;

    constructor(private configService: ConfigService) {
        this.aiServiceUrl =
            resolveAiServiceUrl(this.configService);
        this.logger.log(`SearchRecommendationService init | AI URL: ${this.aiServiceUrl}`);
    }

    /**
     * Get search suggestions via AI service (Gemini AI-powered)
     * All fallback logic is handled inside the AI service (Django).
     */
    async getSuggestions(query: string, count = 10): Promise<SuggestionResult> {
        if (!query?.trim()) return { suggestions: [], source: 'none' };

        const key = `suggest:${query.trim().toLowerCase()}`;

        // Return cached result if fresh
        const cached = this.cache.get(key);
        if (cached && Date.now() - cached.ts < this.CACHE_TTL) {
            this.logger.debug(`Cache HIT: "${query}" | ${cached.data.source}`);
            return cached.data;
        }

        try {
            this.logger.log(`Fetching suggestions for: "${query}"`);
            const response = await axios.get(`${this.aiServiceUrl}/api/tiktok/suggest/`, {
                params: { q: query.trim(), count },
                timeout: 9000, // 9s — AI service uses Gemini (up to 6s)
            });

            const result: SuggestionResult = {
                suggestions: response.data?.suggestions || [],
                source: response.data?.source || 'ai',
            };

            this.logger.log(
                `Suggestions OK | Source: ${result.source} | Count: ${result.suggestions.length}`,
            );

            // Store in cache
            this.cache.set(key, { data: result, ts: Date.now() });

            // Trim cache if too large
            if (this.cache.size > 500) {
                const toDelete = [...this.cache.entries()]
                    .sort((a, b) => a[1].ts - b[1].ts)
                    .slice(0, 250)
                    .map(([k]) => k);
                toDelete.forEach((k) => this.cache.delete(k));
            }

            return result;

        } catch (error: any) {
            this.logger.warn(`AI service suggest failed: ${error?.message}`);
            return { suggestions: [], source: 'error' };
        }
    }

    /**
     * Record a user search term for analytics / DB history
     */
    async recordSearch(query: string, platform = 'TIKTOK'): Promise<void> {
        if (!query?.trim() || query.trim().length < 2) return;

        try {
            await axios.post(
                `${this.aiServiceUrl}/api/search/track/`,
                { query: query.trim(), platform },
                { timeout: 3000 },
            );
        } catch (error: any) {
            this.logger.warn(`Failed to record search: ${error?.message}`);
        }
    }
}
