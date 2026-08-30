import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export type MediaProbe = {
  /** Thời lượng (giây). null khi ffprobe không đọc được. */
  durationSec: number | null;
  width: number | null;
  height: number | null;
  hasVideo: boolean;
  hasAudio: boolean;
};

export type DurationLimits = { minSec: number; maxSec: number };

/**
 * Dấu nhận dạng gắn vào mọi lỗi do cổng kiểm tra media ném ra.
 *
 * Worker thử lại 3 lượt (5 → 15 → 45 phút) cho lỗi đăng bài. Nhưng video thiếu
 * audio hay sai thời lượng thì thử bao nhiêu lần cũng vậy — mỗi kênh chỉ chạy một
 * bài một lúc nên hơn một tiếng đó chặn luôn các bài khác cùng kênh.
 *
 * `isPermanentPublishError` chỉ đọc được mã lỗi số của Meta; lỗi của ta là chuỗi
 * tiếng Việt nên cần dấu này để nhận ra và bỏ qua vòng thử lại.
 */
export const PRECHECK_ERROR_MARKER = '[MEDIA_PRECHECK_FAILED]';

/**
 * Video này có được Facebook đăng dạng Reel không?
 *
 * Quan trọng vì yêu cầu "phải có âm thanh" CHỈ đúng với Reels. Video dài hơn 90
 * giây đi vào /videos — video thường — mà video thường không tiếng là bình
 * thường, chặn nó là chặn nhầm.
 *
 * Không đọc được thời lượng thì trả false: Facebook sẽ lui về /videos, nên coi
 * như không phải Reel.
 */
export function isFacebookReelsCandidate(durationSec: number | null): boolean {
  if (durationSec === null) return false;
  return durationSec >= FACEBOOK_REELS_LIMITS.minSec && durationSec <= FACEBOOK_REELS_LIMITS.maxSec;
}

/**
 * Giới hạn thời lượng theo docs Meta (đã đối chiếu tháng 8/2025).
 * Facebook Reels: 3–90 giây. Instagram Reels: 3 giây – 15 phút.
 */
export const FACEBOOK_REELS_LIMITS: DurationLimits = { minSec: 3, maxSec: 90 };
export const INSTAGRAM_REELS_LIMITS: DurationLimits = { minSec: 3, maxSec: 15 * 60 };

/** Tỉ lệ khung hình lý tưởng cho Reels (9:16 ≈ 0.5625) */
const REELS_ASPECT_RATIO = 9 / 16;
const ASPECT_TOLERANCE = 0.05;

/**
 * Tìm ffprobe: env → cạnh ffmpeg → /usr/bin → gói @ffprobe-installer.
 *
 * Bản trong publish.service.ts thiếu bước cuối, nên trên máy không có
 * /usr/bin/ffprobe (macOS dev, image Docker gọn) thì probe tự tắt im lặng —
 * mọi kiểm tra phía dưới bị bỏ qua mà không ai biết.
 */
export function resolveFFprobePath(): string | null {
  const fromEnv = process.env.FFPROBE_PATH;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;

  const ffmpeg = process.env.FFMPEG_PATH;
  if (ffmpeg && fs.existsSync(ffmpeg)) {
    const candidate = path.join(
      path.dirname(ffmpeg),
      process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe',
    );
    if (fs.existsSync(candidate)) return candidate;
  }

  if (fs.existsSync('/usr/bin/ffprobe')) return '/usr/bin/ffprobe';

  try {
    // Gói này đã nằm trong dependencies và được videos.service.ts dùng.
    const installed = require('@ffprobe-installer/ffprobe')?.path;
    if (installed && fs.existsSync(installed)) return installed;
  } catch {
    // Gói không cài được trên nền tảng hiện tại — bỏ qua.
  }

  return null;
}

/** Tìm ffmpeg: env → /usr/bin → gói @ffmpeg-installer. Cùng thứ tự với resolveFFprobePath. */
export function resolveFFmpegPath(): string | null {
  const fromEnv = process.env.FFMPEG_PATH;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;

  if (fs.existsSync('/usr/bin/ffmpeg')) return '/usr/bin/ffmpeg';

  try {
    const installed = require('@ffmpeg-installer/ffmpeg')?.path;
    if (installed && fs.existsSync(installed)) return installed;
  } catch {
    // Gói không cài được trên nền tảng hiện tại — bỏ qua.
  }

  return null;
}

/**
 * Đọc thông tin kỹ thuật của media. Nhận cả đường dẫn local lẫn URL http(s).
 *
 * Khác `isVideoCompliant` cũ ở chỗ KHÔNG dùng `-select_streams v:0` — phải thấy
 * được luồng audio thì mới phát hiện được video câm.
 *
 * Trả null khi không probe được (thiếu ffprobe, URL không tải nổi, file hỏng).
 * Người gọi tự quyết định coi đó là chặn hay cho qua.
 */
export async function probeMedia(
  input: string,
  ffprobePath?: string | null,
  timeoutMs = 30000,
): Promise<MediaProbe | null> {
  const probePath = ffprobePath ?? resolveFFprobePath();
  if (!probePath) return null;

  try {
    const { stdout } = await execFileAsync(
      probePath,
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', input],
      { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 },
    );
    return parseProbeOutput(stdout);
  } catch {
    return null;
  }
}

/** Tách riêng khỏi probeMedia để test được mà không cần ffprobe thật. */
export function parseProbeOutput(stdout: string): MediaProbe | null {
  let parsed: any;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }

  const streams: any[] = Array.isArray(parsed?.streams) ? parsed.streams : [];
  const videoStream = streams.find((s) => s?.codec_type === 'video');
  const hasAudio = streams.some((s) => s?.codec_type === 'audio');

  const rawDuration = Number(parsed?.format?.duration ?? videoStream?.duration);
  const durationSec = Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : null;

  const width = Number.isFinite(Number(videoStream?.width)) ? Number(videoStream.width) : null;
  const height = Number.isFinite(Number(videoStream?.height)) ? Number(videoStream.height) : null;

  return { durationSec, width, height, hasVideo: !!videoStream, hasAudio };
}

/**
 * Kiểm tra video trước khi đăng. Trả về danh sách lỗi CHẶN (rỗng = hợp lệ).
 *
 * Chỉ chặn những gì chắc chắn hỏng: không có tiếng, thời lượng ngoài giới hạn API.
 * Tỉ lệ khung hình lệch 9:16 vẫn đăng được nên chỉ cảnh báo, xem `collectWarnings`.
 *
 * `limits = null` cho nền tảng có đường lui: Facebook đẩy video dài sang /videos
 * thay vì Reels, nên thời lượng vượt 90s không phải lỗi.
 */
export function validateVideoForPublish(
  probe: MediaProbe,
  opts: { limits?: DurationLimits | null; requireAudio: boolean; label: string },
): string[] {
  const errors: string[] = [];

  if (!probe.hasVideo) {
    errors.push(`${opts.label}: file không chứa luồng video.`);
  }

  if (opts.requireAudio && !probe.hasAudio) {
    errors.push(
      `${opts.label}: video không có luồng âm thanh. Reels không tiếng gần như không được ` +
      `phân phối — kiểm tra lại bản export, hoặc đặt SOCIAL_REQUIRE_AUDIO=false để bỏ qua.`,
    );
  }

  if (opts.limits && probe.durationSec !== null) {
    if (probe.durationSec < opts.limits.minSec) {
      errors.push(
        `${opts.label}: video dài ${probe.durationSec.toFixed(1)}s, ngắn hơn mức tối thiểu ` +
        `${opts.limits.minSec}s.`,
      );
    }
    if (probe.durationSec > opts.limits.maxSec) {
      errors.push(
        `${opts.label}: video dài ${probe.durationSec.toFixed(1)}s, vượt giới hạn ` +
        `${opts.limits.maxSec}s.`,
      );
    }
  }

  return errors;
}

/** Cảnh báo không chặn — ghi log để lần ra nguyên nhân khi bài có ít lượt xem. */
export function collectWarnings(probe: MediaProbe, label: string): string[] {
  const warnings: string[] = [];

  if (probe.width && probe.height) {
    const ratio = probe.width / probe.height;
    if (Math.abs(ratio - REELS_ASPECT_RATIO) > ASPECT_TOLERANCE) {
      warnings.push(
        `${label}: tỉ lệ ${probe.width}x${probe.height} lệch khỏi 9:16 — Reels sẽ thêm viền đen ` +
        `và thường bị phân phối kém hơn.`,
      );
    }
    if (probe.width < 540 || probe.height < 960) {
      warnings.push(
        `${label}: độ phân giải ${probe.width}x${probe.height} thấp hơn mức tối thiểu 540x960.`,
      );
    }
  }

  if (probe.durationSec === null) {
    warnings.push(`${label}: không đọc được thời lượng — bỏ qua kiểm tra giới hạn.`);
  }

  return warnings;
}
