import { PATH_METADATA } from '@nestjs/common/constants';
import { WorkReportController, LarkController } from '../src/modules/work-report/work-report.controller';
import { WorkReportService, LarkService } from '../src/modules/work-report/work-report.service';
import { WorkReportModule, LarkModule } from '../src/modules/work-report/work-report.module';

describe('WorkReport module refactoring & route alias', () => {
  it('WorkReportController hỗ trợ cả 2 route path: work-report và lark (tương thích ngược)', () => {
    const paths = Reflect.getMetadata(PATH_METADATA, WorkReportController);
    expect(paths).toEqual(['work-report', 'lark']);
  });

  it('LarkController là alias tương thích ngược trỏ đến WorkReportController', () => {
    expect(LarkController).toBe(WorkReportController);
  });

  it('LarkService là alias tương thích ngược trỏ đến WorkReportService', () => {
    expect(LarkService).toBe(WorkReportService);
  });

  it('LarkModule là alias tương thích ngược trỏ đến WorkReportModule', () => {
    expect(LarkModule).toBe(WorkReportModule);
  });

  it('WorkReportController khởi tạo và ủy quyền chính xác cho WorkReportService', async () => {
    const mockService: any = {
      getReportData: jest.fn().mockResolvedValue([{ id: 'rep-1', status: 'OK' }]),
      submitChecklistReport: jest.fn().mockResolvedValue({ success: true }),
      submitTrafficReport: jest.fn().mockResolvedValue({ success: true }),
      submitRevenueReport: jest.fn().mockResolvedValue({ success: true }),
      getUserActivityReports: jest.fn().mockResolvedValue({ reports: [] }),
    };
    const mockPrisma: any = {};
    const mockReq: any = {
      user: {
        email: 'test@vcbi.vn',
        full_name: 'Test User',
      },
    };

    const controller = new WorkReportController(mockService, mockPrisma);

    const reports = await controller.getReport();
    expect(mockService.getReportData).toHaveBeenCalled();
    expect(reports).toEqual([{ id: 'rep-1', status: 'OK' }]);

    const checklistRes = await controller.submitChecklistReport({ answers: {} }, mockReq);
    expect(mockService.submitChecklistReport).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'test@vcbi.vn', name: 'Test User' }),
    );
    expect(checklistRes).toEqual({ success: true });

    const trafficRes = await controller.submitTrafficReport({ traffic: {} }, mockReq);
    expect(mockService.submitTrafficReport).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'test@vcbi.vn', name: 'Test User' }),
    );
    expect(trafficRes).toEqual({ success: true });

    const revenueRes = await controller.submitRevenueReport({ revenue: {} }, mockReq);
    expect(mockService.submitRevenueReport).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'test@vcbi.vn', name: 'Test User' }),
    );
    expect(revenueRes).toEqual({ success: true });
  });
});
