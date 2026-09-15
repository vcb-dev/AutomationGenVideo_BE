import { InstagramOwnedAccountsService } from '../src/modules/instagram-owned-accounts/instagram-owned-accounts.service';
import { ThreadsOwnedAccountsService } from '../src/modules/threads-owned-accounts/threads-owned-accounts.service';
import { SocialPlatform } from '@prisma/client';

describe('Owned Channels - Transient Error Resilience & Status Protection', () => {
  describe('InstagramOwnedAccountsService', () => {
    it('không biến lỗi mạng tạm thời (502, 503, timeout) thành lỗi cào vĩnh viễn trên profile', async () => {
      let updatedData: any = null;
      const prismaMock: any = {
        socialAccount: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'sa-1',
              platform: SocialPlatform.INSTAGRAM,
              platform_id: '17841400000000000',
              username: 'congty_official',
              name: 'Công Ty Official',
              access_token_enc: 'enc-token',
              extra_data: { igUserId: '17841400000000000' },
              created_at: new Date(),
            },
          ]),
        },
        scraperInstagramProfile: {
          updateMany: jest.fn().mockImplementation(({ data }) => {
            updatedData = data;
            return Promise.resolve({ count: 1 });
          }),
        },
      };

      const cryptoMock: any = {
        decrypt: jest.fn().mockReturnValue('plain-token'),
      };

      const service = new InstagramOwnedAccountsService(prismaMock, cryptoMock);
      // Giả lập fetchUserProfile ném lỗi tạm thời 502
      jest.spyOn(service, 'fetchUserProfile').mockRejectedValue(new Error('Request failed with status code 502 Bad Gateway'));

      const result = await service.syncAllConnectedAccounts();

      expect(result.failed).toBe(1);
      expect(prismaMock.scraperInstagramProfile.updateMany).toHaveBeenCalled();
      // Với lỗi 502 tạm thời: trạng thái phải về 'idle' và scrape_error = null, không bị cào lỗi vĩnh viễn
      expect(updatedData.scraping_status).toBe('idle');
      expect(updatedData.scrape_error).toBeNull();
    });

    it('ghi nhận lỗi cào thật sự (token hết hạn, quyền) khi gặp lỗi nghiệp vụ', async () => {
      let updatedData: any = null;
      const prismaMock: any = {
        socialAccount: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'sa-2',
              platform: SocialPlatform.INSTAGRAM,
              platform_id: '17841400000000001',
              username: 'congty_expired',
              name: 'Công Ty Expired',
              access_token_enc: 'enc-token',
              extra_data: { igUserId: '17841400000000001' },
              created_at: new Date(),
            },
          ]),
        },
        scraperInstagramProfile: {
          updateMany: jest.fn().mockImplementation(({ data }) => {
            updatedData = data;
            return Promise.resolve({ count: 1 });
          }),
        },
      };

      const cryptoMock: any = {
        decrypt: jest.fn().mockReturnValue('plain-token'),
      };

      const service = new InstagramOwnedAccountsService(prismaMock, cryptoMock);
      jest.spyOn(service, 'fetchUserProfile').mockRejectedValue(new Error('OAuthException: Error validating access token'));

      const result = await service.syncAllConnectedAccounts();

      expect(result.failed).toBe(1);
      expect(prismaMock.scraperInstagramProfile.updateMany).toHaveBeenCalled();
      expect(updatedData.scraping_status).toBe('failed');
      expect(updatedData.scrape_error).toContain('OAuthException');
    });
  });

  describe('ThreadsOwnedAccountsService', () => {
    it('không đánh dấu lỗi vĩnh viễn cho profile Threads khi gặp lỗi mạng tạm thời (timeout, 504)', async () => {
      let updatedData: any = null;
      const prismaMock: any = {
        socialAccount: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'sa-threads-1',
              platform: SocialPlatform.THREADS,
              username: 'threads_company',
              name: 'Threads Company',
              access_token_enc: 'enc-token',
              created_at: new Date(),
            },
          ]),
        },
        scraperThreadsProfile: {
          updateMany: jest.fn().mockImplementation(({ data }) => {
            updatedData = data;
            return Promise.resolve({ count: 1 });
          }),
        },
      };

      const cryptoMock: any = {
        decrypt: jest.fn().mockReturnValue('plain-token'),
      };

      const service = new ThreadsOwnedAccountsService(prismaMock, cryptoMock);
      jest.spyOn(service, 'fetchUserProfile').mockRejectedValue(new Error('connect ETIMEDOUT 157.240.22.63:443'));

      const result = await service.syncAllConnectedAccounts();

      expect(result.failed).toBe(1);
      expect(prismaMock.scraperThreadsProfile.updateMany).toHaveBeenCalled();
      // Với timeout: status về 'idle' và scrape_error = null
      expect(updatedData.scraping_status).toBe('idle');
      expect(updatedData.scrape_error).toBeNull();
    });
  });
});
