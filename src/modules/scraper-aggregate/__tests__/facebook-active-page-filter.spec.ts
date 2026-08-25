import { OwnedStatsService } from '../owned-stats.service';
import { OwnedDuplicateService } from '../owned-duplicate.service';

/**
 * Fanpage đã tắt (`is_active = false`) vẫn bị đếm vào trang Tổng quan kênh nội bộ.
 *
 * Bốn nền tảng còn lại đều lọc `is_owned = true` ở cả câu lấy video lẫn câu lấy danh sách
 * kênh. Riêng Facebook thì không lọc gì: danh sách kênh quét sạch bảng managedfacebookpage,
 * nên ô "Kênh có đăng bài trong kỳ — 12 / 94" có mẫu số gồm cả page đã tắt, và tổng người
 * theo dõi cộng luôn page chết. Trong khi đó buildAlerts() lại lọc `hoat_dong` — hai chỗ
 * nhìn vào hai tập kênh khác nhau.
 *
 * Phải lọc ở CẢ hai câu. Lọc mỗi danh sách kênh thì video của page đã tắt vẫn vào bảng xếp
 * hạng nhưng không tra ngược được sang metadata, đẻ ra một dòng mang tên là page_id trần.
 */
describe('Facebook — chỉ tính fanpage đang bật', () => {
  const stats = new OwnedStatsService(null as never, null as never);
  const duplicates = new OwnedDuplicateService(null as never, null as never);

  const videoSql = (platform = ''): string =>
    (stats as never as { sourceVideos: (p: string, a: Date, b: Date) => { sql: string } })
      .sourceVideos(platform, new Date('2026-08-01'), new Date('2026-08-28')).sql;

  const channelSql = (platform = ''): string =>
    (stats as never as { sourceChannels: (p: string) => { sql: string } }).sourceChannels(platform).sql;

  const duplicateSql = (platform = ''): string =>
    (duplicates as never as { sourceDuplicateVideos: (p: string, a: Date, b: Date) => { sql: string } })
      .sourceDuplicateVideos(platform, new Date('2026-08-01'), new Date('2026-08-28')).sql;

  it('câu lấy video lọc is_active', () => {
    expect(videoSql('facebook')).toMatch(/mp\.is_active = true/);
  });

  it('câu lấy danh sách kênh lọc is_active — đây là mẫu số của "tổng kênh"', () => {
    expect(channelSql('facebook')).toMatch(/mp\.is_active = true/);
  });

  it('câu đếm trùng lặp dùng cùng tập kênh', () => {
    expect(duplicateSql('facebook')).toMatch(/mp\.is_active = true/);
  });

  it('không còn LEFT JOIN sang bảng fanpage — khoá ngoại vốn NOT NULL', () => {
    expect(videoSql('facebook')).not.toMatch(/LEFT JOIN video_management_managedfacebookpage/);
    expect(duplicateSql('facebook')).not.toMatch(/LEFT JOIN video_management_managedfacebookpage/);
  });

  it('bỏ luôn COALESCE(page_id, \'\') — nguồn đẻ ra kênh tên rỗng', () => {
    expect(videoSql('facebook')).not.toMatch(/COALESCE\(mp\.page_id/);
    expect(duplicateSql('facebook')).not.toMatch(/COALESCE\(mp\.page_id/);
  });

  it('gộp tất cả nền tảng thì nhánh Facebook vẫn giữ bộ lọc', () => {
    expect(videoSql('')).toMatch(/mp\.is_active = true/);
    expect(channelSql('')).toMatch(/mp\.is_active = true/);
  });

  it('bốn nền tảng kia không dính is_active, vẫn lọc bằng is_owned', () => {
    for (const platform of ['tiktok', 'instagram', 'youtube', 'threads']) {
      expect(videoSql(platform)).not.toMatch(/is_active/);
      expect(videoSql(platform)).toMatch(/p\.is_owned = true/);
      expect(channelSql(platform)).toMatch(/p\.is_owned = true/);
    }
  });
});
