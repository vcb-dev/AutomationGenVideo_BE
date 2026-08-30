import * as fs from 'fs';
import { PublishService } from '../publish/publish.service';

/**
 * Kiểm bộ đếm "file tạm đang được dùng" và hành vi hoãn xoá của bộ dọn rác.
 *
 * Dựng PublishService với toàn stub — các phép kiểm ở đây chỉ chạm ba phương thức
 * acquireMedia / releaseMedia / scheduleCleanupTranscoded, không đụng DB hay mạng.
 */
function makeService(): any {
  const stub: any = {};
  return new PublishService(stub, stub, stub, stub, stub, stub, stub, stub, stub, stub);
}

describe('PublishService — không xoá file tạm đang được lượt đăng khác dùng', () => {
  let service: any;
  let unlinkSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    service = makeService();
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    unlinkSpy = jest.spyOn(fs, 'unlinkSync').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  const FILE = '/tmp/uploads/social/clip.mp4';
  const TEN_MINUTES = 10 * 60 * 1000;

  it('xoá file khi không còn lượt đăng nào dùng', () => {
    service.scheduleCleanupTranscoded([FILE]);
    jest.advanceTimersByTime(TEN_MINUTES);
    expect(unlinkSpy).toHaveBeenCalledWith(FILE);
  });

  it('HOÃN xoá khi còn lượt đăng khác đang dùng — đây là ca lượt thứ hai trúng cache Drive', () => {
    service.acquireMedia([FILE]);
    service.scheduleCleanupTranscoded([FILE]);

    jest.advanceTimersByTime(TEN_MINUTES);
    expect(unlinkSpy).not.toHaveBeenCalled();
  });

  it('xoá được sau khi lượt đăng kia trả lại file', () => {
    service.acquireMedia([FILE]);
    service.scheduleCleanupTranscoded([FILE]);

    jest.advanceTimersByTime(TEN_MINUTES);
    expect(unlinkSpy).not.toHaveBeenCalled();

    service.releaseMedia([FILE]);
    jest.advanceTimersByTime(TEN_MINUTES);
    expect(unlinkSpy).toHaveBeenCalledWith(FILE);
  });

  it('hoãn tối đa 3 lần rồi xoá dù sao — bộ đếm rò rỉ không được giữ file mãi mãi', () => {
    service.acquireMedia([FILE]); // không bao giờ release
    service.scheduleCleanupTranscoded([FILE]);

    jest.advanceTimersByTime(TEN_MINUTES); // lần 1: hoãn
    jest.advanceTimersByTime(TEN_MINUTES); // lần 2: hoãn
    expect(unlinkSpy).not.toHaveBeenCalled();

    jest.advanceTimersByTime(TEN_MINUTES); // lần 3: xoá dù sao
    expect(unlinkSpy).toHaveBeenCalledWith(FILE);
  });

  it('đếm được nhiều lượt cùng dùng một file', () => {
    service.acquireMedia([FILE]);
    service.acquireMedia([FILE]);
    service.scheduleCleanupTranscoded([FILE]);

    service.releaseMedia([FILE]); // vẫn còn 1 lượt giữ
    jest.advanceTimersByTime(TEN_MINUTES);
    expect(unlinkSpy).not.toHaveBeenCalled();

    service.releaseMedia([FILE]);
    jest.advanceTimersByTime(TEN_MINUTES);
    expect(unlinkSpy).toHaveBeenCalledWith(FILE);
  });

  it('release nhiều hơn acquire không làm bộ đếm âm', () => {
    service.releaseMedia([FILE]);
    service.releaseMedia([FILE]);
    service.acquireMedia([FILE]);
    service.scheduleCleanupTranscoded([FILE]);

    jest.advanceTimersByTime(TEN_MINUTES);
    expect(unlinkSpy).not.toHaveBeenCalled();
  });

  it('danh sách rỗng thì không hẹn giờ gì', () => {
    service.scheduleCleanupTranscoded([]);
    jest.advanceTimersByTime(TEN_MINUTES * 5);
    expect(unlinkSpy).not.toHaveBeenCalled();
  });
});
