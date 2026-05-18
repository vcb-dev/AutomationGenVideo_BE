import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import * as fs from 'fs';

const CHUNK_SIZE = 10 * 1024 * 1024; // 10 MB

@Injectable()
export class TiktokPublisher {
  private readonly logger = new Logger(TiktokPublisher.name);

  async publish(token: string, opts: {
    caption: string; mediaUrls: string[];
  }): Promise<{ publishId: string; status: string }> {
    if (!opts.mediaUrls?.length) throw new Error('TikTok yêu cầu video');
    const videoUrl = opts.mediaUrls[0];

    const fileSize = await this.getFileSize(videoUrl);
    const totalChunks = Math.ceil(fileSize / CHUNK_SIZE);

    // 1. Init upload
    const initRes = await axios.post(
      'https://open.tiktokapis.com/v2/post/publish/video/init/',
      {
        post_info: {
          title: opts.caption.substring(0, 2200),
          privacy_level: 'PUBLIC_TO_EVERYONE',
          disable_duet: false,
          disable_comment: false,
          disable_stitch: false,
        },
        source_info: {
          source: 'FILE_UPLOAD',
          video_size: fileSize,
          chunk_size: CHUNK_SIZE,
          total_chunk_count: totalChunks,
        },
      },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' } },
    );

    const { publish_id, upload_url } = initRes.data.data;
    this.logger.log(`[TikTok] Init ok — publish_id: ${publish_id}`);

    // 2. Upload chunks
    await this.uploadChunks(videoUrl, upload_url, fileSize);
    this.logger.log(`[TikTok] Upload chunks done — polling status...`);

    // 3. Poll status until PUBLISH_COMPLETE or FAILED (tối đa 60s)
    const finalStatus = await this.pollStatus(token, publish_id);
    this.logger.log(`[TikTok] Final status: ${finalStatus}`);

    if (finalStatus !== 'PUBLISH_COMPLETE') {
      throw new Error(`TikTok publishing failed (status=${finalStatus})`);
    }

    return { publishId: publish_id, status: finalStatus };
  }

  private async pollStatus(token: string, publishId: string, maxAttempts = 20): Promise<string> {
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      try {
        const res = await axios.post(
          'https://open.tiktokapis.com/v2/post/publish/status/fetch/',
          { publish_id: publishId },
          { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' } },
        );
        const status = res.data?.data?.status;
        this.logger.log(`[TikTok] Poll ${i + 1}: status=${status}`);
        if (['PUBLISH_COMPLETE', 'FAILED'].includes(status)) return status;
      } catch (err: any) {
        const httpStatus = err.response?.status;
        if (httpStatus && httpStatus >= 400 && httpStatus < 500) {
          throw new Error(`TikTok poll thất bại vĩnh viễn (HTTP ${httpStatus}): ${err.response?.data ? JSON.stringify(err.response.data) : err.message}`);
        }
        this.logger.warn(`[TikTok] Poll error (retrying): ${err.message}`);
      }
    }
    return 'TIMEOUT';
  }

  private async getFileSize(urlOrPath: string): Promise<number> {
    if (urlOrPath.startsWith('http')) {
      const r = await axios.head(urlOrPath);
      const size = parseInt(r.headers['content-length'] || '0');
      if (!size) throw new Error(`TikTok: không lấy được kích thước file từ ${urlOrPath} (Content-Length thiếu)`);
      return size;
    }
    try {
      return fs.statSync(urlOrPath).size;
    } catch (e: any) {
      throw new Error(`TikTok: không đọc được file local ${urlOrPath}: ${e.message}`);
    }
  }

  private async uploadChunks(videoUrl: string, uploadUrl: string, fileSize: number) {
    let start = 0;
    let chunkIndex = 0;
    while (start < fileSize) {
      const end = Math.min(start + CHUNK_SIZE - 1, fileSize - 1);
      let chunk: Buffer;

      if (videoUrl.startsWith('http')) {
        const r = await axios.get(videoUrl, {
          responseType: 'arraybuffer',
          headers: { Range: `bytes=${start}-${end}` },
        });
        chunk = Buffer.from(r.data);
      } else {
        let fd: number | null = null;
        try {
          fd = fs.openSync(videoUrl, 'r');
          chunk = Buffer.alloc(end - start + 1);
          fs.readSync(fd, chunk, 0, chunk.length, start);
        } finally {
          if (fd !== null) fs.closeSync(fd);
        }
      }

      await axios.put(uploadUrl, chunk, {
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Content-Length': chunk.length,
        },
      });

      this.logger.log(`[TikTok] Chunk ${chunkIndex + 1} uploaded (${start}-${end}/${fileSize})`);
      start = end + 1;
      chunkIndex++;
    }
  }
}
