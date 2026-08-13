import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import axios from 'axios';
import { resolveAiServiceUrlFromEnv } from '../../../common/config/ai-service-url';

const KEYWORD_MAP: Record<string, string[]> = {
  vàng:   ['#VangBac','#TrangSuc','#NuTrang','#Vang'],
  bạc:    ['#VangBac','#TrangSuc','#SilverJewelry'],
  nhẫn:   ['#Nhan','#NhanDoi','#EngagementRing'],
  dây:    ['#DayChuyen','#Necklace'],
  vòng:   ['#VongTay','#Bracelet'],
  phong:  ['#PhongThuy','#MayMan','#TaiLoc'],
  quà:    ['#QuaTang','#Gift','#QuaYNghia'],
  tặng:   ['#QuaTang','#TangQua'],
  cưới:   ['#NhanCuoi','#TrangSucCuoi','#WeddingJewelry'],
  sinh:   ['#QuaSinhNhat','#SinhNhat','#Birthday'],
  sức:    ['#TrangSuc','#Jewelry'],
  đá:     ['#DaQuy','#Diamond','#Ruby'],
  kim:    ['#KimCuong','#Diamond','#KimHoan'],
  ngọc:   ['#Ngoc','#Jade','#NgocTrai'],
  sale:   ['#Sale','#KhuyenMai','#GiamGia'],
  giảm:   ['#GiamGia','#Sale','#KhuyenMai'],
  handmade: ['#Handmade','#ThuCong'],
  luxury: ['#Luxury','#HighEnd'],
  hoa:    ['#HoaTiet','#FlowerDesign'],
};

const BRAND_HASHTAGS = ['#VienChiBao','#VCBStudio','#TrangSucViet','#KimHoanVietNam'];

function extractHashtagsFromText(text: string): string[] {
  const lower = text.toLowerCase();
  const found = new Set<string>();
  for (const [keyword, tags] of Object.entries(KEYWORD_MAP)) {
    if (lower.includes(keyword)) tags.forEach(t => found.add(t));
  }
  const existing = text.match(/#\w+/g) || [];
  existing.forEach(t => found.add(t));
  BRAND_HASHTAGS.slice(0, 3).forEach(t => found.add(t));
  return Array.from(found).slice(0, 20);
}

@ApiTags('Social Hashtag')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('social/hashtag')
export class HashtagController {

  @Post('suggest')
  @ApiOperation({ summary: 'Gợi ý hashtag từ nội dung bài đăng (AI + keyword extraction)' })
  async suggest(@Body() body: { message: string; platform?: string; industry?: string }) {
    const { message, platform, industry = 'kim hoàn trang sức' } = body;
    if (!message?.trim()) return { hashtags: BRAND_HASHTAGS.slice(0, 10), source: 'keyword' };
    // Giới hạn 5000 ký tự để tránh DoS qua AI service
    const safeMessage = message.slice(0, 5000);

    const aiUrl = resolveAiServiceUrlFromEnv();
    if (aiUrl) {
      try {
        const res = await axios.post(`${aiUrl}/api/content/generate/`, {
          video_description: safeMessage, content_type: 'A1', industry, brand_name: 'Viễn Chí Bảo',
          additional_context: `Hãy CHỈ TRẢ VỀ danh sách 15-20 hashtag phù hợp cho bài ${platform || 'Facebook/Instagram'}, mỗi hashtag bắt đầu bằng #, cách nhau bởi dấu cách, KHÔNG giải thích.`,
        }, { timeout: 8000 });
        const content: string = res.data?.content || res.data?.generated_content || '';
        const aiTags = (content.match(/#\w+/g) || []).slice(0, 20);
        if (aiTags.length >= 5) return { hashtags: aiTags, source: 'ai' };
      } catch (e: any) { /* AI service không khả dụng, fallback sang keyword */ }
    }

    return { hashtags: extractHashtagsFromText(safeMessage), source: 'keyword' };
  }
}
