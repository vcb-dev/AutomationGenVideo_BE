import { PrismaService } from '../prisma.service';

describe('PrismaService Self-Healing Tables', () => {
  let service: PrismaService;

  beforeEach(() => {
    service = new PrismaService();
  });

  afterEach(async () => {
    await service.$disconnect().catch(() => {});
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should have ensureRequiredTables method that executes raw sql safely', async () => {
    const executeSpy = jest.spyOn(service as any, '$executeRawUnsafe').mockResolvedValue(1);
    await (service as any).ensureRequiredTables();
    expect(executeSpy).toHaveBeenCalled();
  });
});
