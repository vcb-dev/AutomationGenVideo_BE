import { Test, TestingModule } from '@nestjs/testing';
import { ThreadsOwnedAccountsCronService } from '../threads-owned-accounts-cron.service';
import { ThreadsOwnedAccountsService } from '../threads-owned-accounts.service';

describe('ThreadsOwnedAccountsCronService', () => {
  let cronService: ThreadsOwnedAccountsCronService;
  let ownedService: jest.Mocked<Partial<ThreadsOwnedAccountsService>>;

  beforeEach(async () => {
    ownedService = {
      syncAllConnectedAccounts: jest.fn().mockResolvedValue({
        accounts: 1,
        createdProfiles: 0,
        updatedProfiles: 1,
        syncedPosts: 10,
        failed: 0,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ThreadsOwnedAccountsCronService,
        {
          provide: ThreadsOwnedAccountsService,
          useValue: ownedService,
        },
      ],
    }).compile();

    cronService = module.get<ThreadsOwnedAccountsCronService>(ThreadsOwnedAccountsCronService);
  });

  it('should be defined', () => {
    expect(cronService).toBeDefined();
  });

  it('calls syncAllConnectedAccounts on cron trigger', async () => {
    await cronService.cronSyncOwnedThreads();
    expect(ownedService.syncAllConnectedAccounts).toHaveBeenCalledTimes(1);
  });

  it('catches and logs errors without throwing unhandled rejection', async () => {
    ownedService.syncAllConnectedAccounts = jest.fn().mockRejectedValue(new Error('Network failure'));
    await expect(cronService.cronSyncOwnedThreads()).resolves.not.toThrow();
  });
});
