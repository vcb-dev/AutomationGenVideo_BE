import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';

/**
 * Phản hồi có thật sự là ảnh không?
 *
 * CDN của Facebook/TikTok khi chặn hotlink thường trả HTTP 200 kèm trang HTML báo lỗi chứ
 * không trả mã lỗi. Không kiểm thì trang HTML đó được đẩy thẳng lên Cloudinary: tốn credit
 * và tạo asset rác mà bản ghi DB vẫn tưởng là đã có ảnh.
 */
export function isImageContentType(contentType?: string | null): boolean {
  return !!contentType && contentType.trim().toLowerCase().startsWith('image/');
}

@Injectable()
export class CloudinaryStorageService {
  private readonly logger = new Logger(CloudinaryStorageService.name);
  private isConfigured = false;
  private readonly rootFolder: string;

  constructor(private readonly configService: ConfigService) {
    const cloudName = this.configService.get<string>('CLOUDINARY_CLOUD_NAME') || process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = this.configService.get<string>('CLOUDINARY_API_KEY') || process.env.CLOUDINARY_API_KEY;
    const apiSecret = this.configService.get<string>('CLOUDINARY_API_SECRET') || process.env.CLOUDINARY_API_SECRET;
    const cloudinaryUrl = this.configService.get<string>('CLOUDINARY_URL') || process.env.CLOUDINARY_URL;
    this.rootFolder = this.configService.get<string>('CLOUDINARY_ROOT_FOLDER') || process.env.CLOUDINARY_ROOT_FOLDER || 'vcb-thumbnails';

    if (cloudinaryUrl) {
      cloudinary.config({ cloudinary_url: cloudinaryUrl });
      this.isConfigured = true;
      this.logger.log('✅ Cloudinary Storage initialized via CLOUDINARY_URL');
    } else if (cloudName && apiKey && apiSecret) {
      cloudinary.config({
        cloud_name: cloudName,
        api_key: apiKey,
        api_secret: apiSecret,
        secure: true,
      });
      this.isConfigured = true;
      this.logger.log(`✅ Cloudinary Storage initialized for cloud: ${cloudName} (Root folder: ${this.rootFolder})`);
    } else {
      this.logger.warn('⚠️ Cloudinary chưa được cấu hình (cần CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET).');
    }
  }

  isAvailable(): boolean {
    return this.isConfigured;
  }

  /**
   * Upload thumbnail hoặc avatar từ URL CDN gốc lên Cloudinary
   * Sử dụng axios tải buffer kèm browser headers để vượt qua cơ chế chặn 403 của Facebook/Douyin/TikTok CDN,
   * sau đó đẩy trực tiếp qua upload_stream vào folder `vcb-thumbnails/{platform}/`.
   */
  async uploadThumbnailFromUrl(
    sourceUrl: string,
    publicId: string,
    platform: string = 'general',
  ): Promise<string | null> {
    if (!this.isConfigured || !sourceUrl || !sourceUrl.trim()) return null;

    const folder = `${this.rootFolder}/${platform.toLowerCase().trim()}`;
    const cleanPublicId = publicId.replace(/\.[^/.]+$/, '');

    try {
      const resp = await axios.get(sourceUrl, {
        responseType: 'arraybuffer',
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
          'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        },
      });

      // Ném lỗi để rơi xuống nhánh fallback: Cloudinary tự fetch bằng IP của họ, đôi khi
      // không bị CDN chặn như request đi từ server mình.
      if (!isImageContentType(resp.headers['content-type'] as string)) {
        throw new Error(`Phản hồi không phải ảnh (content-type: ${resp.headers['content-type']})`);
      }

      const buffer = Buffer.from(resp.data);
      return new Promise<string | null>((resolve) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            folder,
            public_id: cleanPublicId,
            overwrite: true,
            resource_type: 'image',
            // Chỉ quality: auto. fetch_format/f_auto là tuỳ chọn lúc PHÂN PHỐI, đặt ở bước
            // upload thì Cloudinary bỏ qua — để lại chỉ gây hiểu nhầm là đã bật f_auto.
            transformation: [{ quality: 'auto' }],
          },
          (error, result) => {
            if (error || !result) {
              this.logger.error(`[Cloudinary] Stream upload failed for ${platform} (${cleanPublicId}): ${error?.message}`);
              resolve(null);
            } else {
              resolve(result.secure_url);
            }
          },
        );
        uploadStream.end(buffer);
      });
    } catch (err: any) {
      // Fallback: thử để Cloudinary tự fetch trực tiếp từ URL
      try {
        const result: UploadApiResponse = await cloudinary.uploader.upload(sourceUrl, {
          folder,
          public_id: cleanPublicId,
          overwrite: true,
          resource_type: 'image',
          transformation: [{ quality: 'auto' }],
        });
        return result.secure_url;
      } catch (fallbackErr: any) {
        this.logger.error(`[Cloudinary] Upload failed for ${platform} (${cleanPublicId}): ${fallbackErr.message}`);
        return null;
      }
    }
  }
}
