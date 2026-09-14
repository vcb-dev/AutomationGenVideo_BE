import {
  PRECHECK_ERROR_MARKER,
  isFacebookReelsCandidate,
  parseProbeOutput,
  validateVideoForPublish,
  collectWarnings,
  FACEBOOK_REELS_LIMITS,
  INSTAGRAM_REELS_LIMITS,
  MediaProbe,
} from '../publish/media-probe.util';

/** Dựng output ffprobe tối thiểu để test parse mà không cần ffprobe thật */
function ffprobeJson(opts: { duration?: string; width?: number; height?: number; audio?: boolean }) {
  const streams: any[] = [];
  if (opts.width !== undefined) {
    streams.push({ codec_type: 'video', codec_name: 'h264', width: opts.width, height: opts.height });
  }
  if (opts.audio) streams.push({ codec_type: 'audio', codec_name: 'aac' });
  return JSON.stringify({ streams, format: { duration: opts.duration } });
}

const reelProbe: MediaProbe = {
  durationSec: 30, width: 1080, height: 1920, hasVideo: true, hasAudio: true,
};

describe('parseProbeOutput', () => {
  it('đọc được thời lượng, kích thước và phát hiện có audio', () => {
    const probe = parseProbeOutput(ffprobeJson({ duration: '42.5', width: 1080, height: 1920, audio: true }));
    expect(probe).toEqual({
      durationSec: 42.5, width: 1080, height: 1920, hasVideo: true, hasAudio: true,
    });
  });

  it('phát hiện video CÂM — đây là ca mà isVideoCompliant cũ bỏ sót vì chỉ đọc luồng v:0', () => {
    const probe = parseProbeOutput(ffprobeJson({ duration: '30', width: 1080, height: 1920, audio: false }));
    expect(probe!.hasAudio).toBe(false);
    expect(probe!.hasVideo).toBe(true);
  });

  it('trả null khi ffprobe không xuất JSON hợp lệ', () => {
    expect(parseProbeOutput('không phải json')).toBeNull();
  });

  it('durationSec là null khi ffprobe không đọc được thời lượng, không phải NaN hay 0', () => {
    const probe = parseProbeOutput(ffprobeJson({ width: 1080, height: 1920, audio: true }));
    expect(probe!.durationSec).toBeNull();
  });
});

describe('validateVideoForPublish', () => {
  it('video hợp lệ không sinh lỗi nào', () => {
    const errors = validateVideoForPublish(reelProbe, {
      limits: INSTAGRAM_REELS_LIMITS, requireAudio: true, label: 'reel.mp4',
    });
    expect(errors).toEqual([]);
  });

  it('CHẶN video câm khi requireAudio — reel không tiếng gần như không được phân phối', () => {
    const errors = validateVideoForPublish(
      { ...reelProbe, hasAudio: false },
      { limits: INSTAGRAM_REELS_LIMITS, requireAudio: true, label: 'reel.mp4' },
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('không có luồng âm thanh');
  });

  it('cho qua video câm khi requireAudio=false (lối thoát SOCIAL_REQUIRE_AUDIO)', () => {
    const errors = validateVideoForPublish(
      { ...reelProbe, hasAudio: false },
      { limits: INSTAGRAM_REELS_LIMITS, requireAudio: false, label: 'reel.mp4' },
    );
    expect(errors).toEqual([]);
  });

  it('chặn video vượt 15 phút của Instagram — Instagram không có dạng video thường để lui về', () => {
    const errors = validateVideoForPublish(
      { ...reelProbe, durationSec: 16 * 60 },
      { limits: INSTAGRAM_REELS_LIMITS, requireAudio: true, label: 'dai.mp4' },
    );
    expect(errors.some(e => e.includes('vượt giới hạn'))).toBe(true);
  });

  it('chặn video ngắn hơn 3 giây', () => {
    const errors = validateVideoForPublish(
      { ...reelProbe, durationSec: 2 },
      { limits: INSTAGRAM_REELS_LIMITS, requireAudio: true, label: 'ngan.mp4' },
    );
    expect(errors.some(e => e.includes('ngắn hơn mức tối thiểu'))).toBe(true);
  });

  it('limits=null thì KHÔNG chặn theo thời lượng — Facebook lui về /videos cho video dài', () => {
    const errors = validateVideoForPublish(
      { ...reelProbe, durationSec: 20 * 60 },
      { limits: null, requireAudio: true, label: 'dai.mp4' },
    );
    expect(errors).toEqual([]);
  });

  it('không chặn theo thời lượng khi không đọc được duration', () => {
    const errors = validateVideoForPublish(
      { ...reelProbe, durationSec: null },
      { limits: INSTAGRAM_REELS_LIMITS, requireAudio: true, label: 'x.mp4' },
    );
    expect(errors).toEqual([]);
  });

  it('chặn file không có luồng video', () => {
    const errors = validateVideoForPublish(
      { durationSec: 30, width: null, height: null, hasVideo: false, hasAudio: true },
      { limits: INSTAGRAM_REELS_LIMITS, requireAudio: true, label: 'audio-only.mp4' },
    );
    expect(errors.some(e => e.includes('không chứa luồng video'))).toBe(true);
  });
});

describe('collectWarnings — cảnh báo, không chặn', () => {
  it('video 9:16 chuẩn không có cảnh báo', () => {
    expect(collectWarnings(reelProbe, 'reel.mp4')).toEqual([]);
  });

  it('cảnh báo khi video ngang 16:9', () => {
    const warnings = collectWarnings({ ...reelProbe, width: 1920, height: 1080 }, 'ngang.mp4');
    expect(warnings.some(w => w.includes('lệch khỏi 9:16'))).toBe(true);
  });

  it('cảnh báo khi độ phân giải dưới 540x960', () => {
    const warnings = collectWarnings({ ...reelProbe, width: 360, height: 640 }, 'nho.mp4');
    expect(warnings.some(w => w.includes('thấp hơn mức tối thiểu'))).toBe(true);
  });

  it('cảnh báo khi không đọc được thời lượng', () => {
    const warnings = collectWarnings({ ...reelProbe, durationSec: null }, 'x.mp4');
    expect(warnings.some(w => w.includes('không đọc được thời lượng'))).toBe(true);
  });
});

describe('isFacebookReelsCandidate — quyết định video có phải Reel không', () => {
  it('trong khoảng 3–90 giây thì là Reel', () => {
    expect(isFacebookReelsCandidate(3)).toBe(true);
    expect(isFacebookReelsCandidate(30)).toBe(true);
    expect(isFacebookReelsCandidate(90)).toBe(true);
  });

  it('dài hơn 90 giây KHÔNG phải Reel — Facebook đăng dạng video thường', () => {
    expect(isFacebookReelsCandidate(91)).toBe(false);
    expect(isFacebookReelsCandidate(200.5)).toBe(false);
  });

  it('ngắn hơn 3 giây cũng không phải Reel', () => {
    expect(isFacebookReelsCandidate(2)).toBe(false);
  });

  it('không đọc được thời lượng thì coi như không phải Reel — Facebook sẽ lui về /videos', () => {
    expect(isFacebookReelsCandidate(null)).toBe(false);
  });
});

describe('PRECHECK_ERROR_MARKER', () => {
  it('là chuỗi ổn định để isPermanentPublishError nhận ra và bỏ qua vòng thử lại 65 phút', () => {
    // Đổi giá trị này phải sửa cả luật tương ứng trong publish-error.util.ts
    expect(PRECHECK_ERROR_MARKER).toBe('[MEDIA_PRECHECK_FAILED]');
  });
});

describe('giới hạn theo docs Meta', () => {
  it('Facebook Reels 3–90 giây', () => {
    expect(FACEBOOK_REELS_LIMITS).toEqual({ minSec: 3, maxSec: 90 });
  });

  it('Instagram Reels 3 giây – 15 phút', () => {
    expect(INSTAGRAM_REELS_LIMITS).toEqual({ minSec: 3, maxSec: 900 });
  });
});
