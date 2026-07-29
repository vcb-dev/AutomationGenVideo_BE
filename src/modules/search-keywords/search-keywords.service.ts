import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { unaccent } from '../../common/utils/unaccent.util';

// Port từ scraper_views.py::keyword_suggest/keyword_hit/keyword_list/keyword_create
// (AI đã xóa) — SearchKeyword là bookkeeping nội bộ (gợi ý + đếm lượt dùng từ khóa
// tìm kiếm trên các nền tảng), không phải dữ liệu cào 3rd-party, nhưng vẫn chuyển
// sang BE để AI không đụng DB ở bất kỳ đâu.
@Injectable()
export class SearchKeywordsService {
  constructor(private readonly prisma: PrismaService) {}

  async suggest(q: string): Promise<{ suggestions: { id: number; keyword: string; hits: number }[] }> {
    const where = q ? { cleaned_keyword_ascii: { contains: unaccent(q).toLowerCase(), mode: 'insensitive' as const } } : {};

    const top = await this.prisma.scraperSearchKeyword.findMany({
      where,
      orderBy: { hit_count: 'desc' },
      take: 10,
    });

    return {
      suggestions: top.map((kw) => ({ id: Number(kw.id), keyword: kw.cleaned_keyword, hits: kw.hit_count })),
    };
  }

  async hit(keywordText: string): Promise<{ id: number; keyword: string; hits: number; created: boolean }> {
    const asciiVersion = unaccent(keywordText).toLowerCase();

    const existing = await this.prisma.scraperSearchKeyword.findFirst({ where: { cleaned_keyword: keywordText } });

    if (!existing) {
      const kw = await this.prisma.scraperSearchKeyword.create({
        data: { cleaned_keyword: keywordText, cleaned_keyword_ascii: asciiVersion, hit_count: 1 },
      });
      return { id: Number(kw.id), keyword: kw.cleaned_keyword, hits: kw.hit_count, created: true };
    }

    const updated = await this.prisma.scraperSearchKeyword.update({
      where: { id: existing.id },
      data: { hit_count: existing.hit_count + 1 },
    });
    return { id: Number(updated.id), keyword: updated.cleaned_keyword, hits: updated.hit_count, created: false };
  }

  async list(): Promise<{ keywords: any[]; count: number }> {
    const keywords = await this.prisma.scraperSearchKeyword.findMany({ orderBy: { hit_count: 'desc' } });

    return {
      keywords: keywords.map((kw) => ({
        id: Number(kw.id),
        keyword: kw.cleaned_keyword,
        hits: kw.hit_count,
        last_searched_at: kw.last_searched_at,
      })),
      count: keywords.length,
    };
  }

  async create(keywordText: string): Promise<{ id: number; keyword: string; created: true }> {
    const asciiVersion = unaccent(keywordText).toLowerCase();

    const existing = await this.prisma.scraperSearchKeyword.findFirst({ where: { cleaned_keyword: keywordText } });
    if (existing) {
      throw new HttpException({ error: 'Keyword already exists', id: Number(existing.id) }, HttpStatus.CONFLICT);
    }

    const kw = await this.prisma.scraperSearchKeyword.create({
      data: { cleaned_keyword: keywordText, cleaned_keyword_ascii: asciiVersion, hit_count: 0 },
    });
    return { id: Number(kw.id), keyword: kw.cleaned_keyword, created: true };
  }
}
