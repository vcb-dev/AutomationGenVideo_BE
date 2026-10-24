import { Injectable } from '@nestjs/common';
import { MemsPhotoUrlSigner } from '../../../common/mems/photo-url-signer.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

@Injectable()
export class RequestExtrasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly photoUrls: MemsPhotoUrlSigner,
  ) {}

  /** Gắn ảnh người mượn, lần xin gia hạn gần nhất và các sự cố vào phiếu trả ra cho FE. */
  async attach<T extends { id: string }>(requests: T[]) {
    const ids = requests.map((r) => r.id);
    if (ids.length === 0) return [];
    const [photos, extensions, incidents] = await Promise.all([
      this.prisma.memsRequestPhoto.findMany({ where: { request_id: { in: ids } }, orderBy: { created_at: 'asc' } }),
      this.prisma.memsLoanExtension.findMany({ where: { request_id: { in: ids } }, orderBy: { requested_at: 'desc' } }),
      this.prisma.memsIncident.findMany({
        where: { request_id: { in: ids } },
        include: { asset: { select: { id: true, asset_code: true, serial_number: true } } },
        orderBy: { created_at: 'desc' },
      }),
    ]);
    return requests.map((request) => {
      const own = photos.filter((p) => p.request_id === request.id);
      return {
        ...request,
        photos: own.filter((p) => !p.incident_id).map((p) => this.photoUrls.sign(p.url)),
        extension: extensions.find((e) => e.request_id === request.id) ?? null,
        incidents: incidents
          .filter((i) => i.request_id === request.id)
          .map((i) => ({
            ...i,
            photos: own.filter((p) => p.incident_id === i.id).map((p) => this.photoUrls.sign(p.url)),
          })),
      };
    });
  }
}
