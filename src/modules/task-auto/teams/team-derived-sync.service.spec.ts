import { TeamDerivedSyncService } from './team-derived-sync.service';

describe('TeamDerivedSyncService', () => {
  it('dọn dẹp các dòng team_members mồ côi và đồng bộ users.team khi resync', async () => {
    const prisma: any = {
      isHealthy: true,
      $executeRaw: jest.fn().mockResolvedValue(1),
    };

    const service = new TeamDerivedSyncService(prisma);
    await service.resyncDriftedUserTeams();

    expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
  });

  it('bỏ qua resync nếu prisma không healthy', async () => {
    const prisma: any = {
      isHealthy: false,
      $executeRaw: jest.fn(),
    };

    const service = new TeamDerivedSyncService(prisma);
    await service.resyncDriftedUserTeams();

    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });
});
