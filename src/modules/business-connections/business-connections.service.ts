import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class BusinessConnectionsService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.businessChannelConnection.findMany({
      orderBy: { created_at: 'desc' }
    });
  }

  // Phương thức tạm để seed dữ liệu
  async seedData() {
    const count = await this.prisma.businessChannelConnection.count();
    if (count === 0) {
      await this.prisma.businessChannelConnection.createMany({
        data: [
          {
            platform_id: '17841470083440008',
            channel_name: 'HuyK - Xưởng Chế Tác',
            platform: 'Instagram',
            connection_type: 'Kênh nội dung',
            sync_status: 'Chưa đồng bộ',
            creator_email: 'vienchibao6868@gmail.com',
            is_active: true,
            avatar_url: 'https://ui-avatars.com/api/?name=HX&background=e1306c&color=fff'
          },
          {
            platform_id: '458547740678011',
            channel_name: 'HuyK - Xưởng Chế Tác',
            platform: 'Facebook',
            connection_type: 'Kênh nội dung',
            sync_status: 'Chưa đồng bộ',
            creator_email: 'viet71098@gmail.com',
            is_active: true,
            avatar_url: 'https://ui-avatars.com/api/?name=HX&background=1877f2&color=fff'
          },
          {
            platform_id: '363698766819617',
            channel_name: 'Nhạn Nhạn - Văn Phòng Các',
            platform: 'Facebook',
            connection_type: 'Kênh nội dung',
            sync_status: 'Chưa đồng bộ',
            creator_email: 'viet71098@gmail.com',
            is_active: true,
            avatar_url: 'https://ui-avatars.com/api/?name=NN&background=1877f2&color=fff'
          },
          {
            platform_id: '-DD0U8Ake91pBk-DCUSWjgXsI4xN_dMdtUv',
            channel_name: 'HuyK-Thợ Trang Sức Đá Quý',
            platform: 'TikTok',
            connection_type: 'Kênh nội dung',
            sync_status: 'Chưa đồng bộ',
            creator_email: 'vienchibao6868@gmail.com',
            is_active: true,
            avatar_url: 'H'
          }
        ]
      });
    }
    return { success: true, message: "Seed completed" };
  }
}
