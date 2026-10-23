import { RequestExtrasService } from '../request-extras.service';

const signer = { sign: (url: string) => `${url}?t=signed` } as any;

function buildPrisma() {
  return {
    memsRequestPhoto: {
      findMany: jest.fn(async () => [
        { request_id: 'req-1', incident_id: null, url: '/api/mems/photos/REQ_1_aaaa.jpg' },
        { request_id: 'req-1', incident_id: 'inc-1', url: '/api/mems/photos/REQ_2_bbbb.jpg' },
      ]),
    },
    memsLoanExtension: {
      findMany: jest.fn(async () => [
        { id: 'ext-2', request_id: 'req-1', status: 'PENDING' },
        { id: 'ext-1', request_id: 'req-1', status: 'REJECTED' },
      ]),
    },
    memsIncident: {
      findMany: jest.fn(async () => [{ id: 'inc-1', request_id: 'req-1', kind: 'CONDITION_WORSENED' }]),
    },
  } as any;
}

describe('RequestExtrasService.attach', () => {
  it('ảnh đính kèm phiếu không lẫn ảnh sự cố, URL đã ký', async () => {
    const [row] = await new RequestExtrasService(buildPrisma(), signer).attach([{ id: 'req-1' }]);
    expect(row.photos).toEqual(['/api/mems/photos/REQ_1_aaaa.jpg?t=signed']);
  });

  it('extension là lần xin gần nhất', async () => {
    const [row] = await new RequestExtrasService(buildPrisma(), signer).attach([{ id: 'req-1' }]);
    expect(row.extension).toMatchObject({ id: 'ext-2', status: 'PENDING' });
  });

  it('sự cố mang theo ảnh của chính nó', async () => {
    const [row] = await new RequestExtrasService(buildPrisma(), signer).attach([{ id: 'req-1' }]);
    expect(row.incidents).toEqual([
      expect.objectContaining({ id: 'inc-1', photos: ['/api/mems/photos/REQ_2_bbbb.jpg?t=signed'] }),
    ]);
  });

  it('phiếu không có gì thì trả mảng rỗng và null', async () => {
    const [row] = await new RequestExtrasService(buildPrisma(), signer).attach([{ id: 'req-9' }]);
    expect(row).toMatchObject({ photos: [], extension: null, incidents: [] });
  });

  it('danh sách rỗng thì không truy vấn gì', async () => {
    const prisma = buildPrisma();
    expect(await new RequestExtrasService(prisma, signer).attach([])).toEqual([]);
    expect(prisma.memsRequestPhoto.findMany).not.toHaveBeenCalled();
  });
});
