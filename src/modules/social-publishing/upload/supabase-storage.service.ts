import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as ws from 'ws';

@Injectable()
export class SupabaseStorageService implements OnModuleInit {
  private client: SupabaseClient;
  private readonly logger = new Logger(SupabaseStorageService.name);
  private available = false;
  private bucket: string;

  onModuleInit() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    this.bucket = process.env.SUPABASE_STORAGE_BUCKET || 'social-uploads';

    if (!url || !key) {
      this.logger.warn('⚠️  SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY chưa được cấu hình — upload sẽ dùng disk local');
      return;
    }

    this.client = createClient(url, key, { 
      auth: { persistSession: false },
      realtime: { transport: ws as any }
    });
    this.available = true;
    this.logger.log(`✅ Supabase Storage sẵn sàng (bucket: ${this.bucket})`);
  }

  isAvailable(): boolean {
    return this.available;
  }

  /** Upload từ Buffer — dùng cho ảnh nhỏ */
  async upload(buffer: Buffer, filename: string, mimetype: string): Promise<string> {
    const { error } = await this.client.storage
      .from(this.bucket)
      .upload(filename, buffer, { contentType: mimetype, upsert: true });

    if (error) throw new Error(`Supabase upload thất bại: ${error.message}`);
    return this.getPublicUrl(filename);
  }

  /** Upload từ file path dùng ReadableStream — dùng cho video lớn, tránh OOM */
  async uploadFromPath(filePath: string, filename: string, mimetype: string): Promise<string> {
    const stream = fs.createReadStream(filePath);
    const { error } = await this.client.storage
      .from(this.bucket)
      .upload(filename, stream as any, { contentType: mimetype, upsert: true, duplex: 'half' } as any);

    if (error) throw new Error(`Supabase stream upload thất bại: ${error.message}`);
    this.logger.log(`[Supabase] ✅ Stream uploaded: ${filename}`);
    return this.getPublicUrl(filename);
  }

  getPublicUrl(filename: string): string {
    const { data } = this.client.storage.from(this.bucket).getPublicUrl(filename);
    return data.publicUrl;
  }

  async delete(filenames: string[]): Promise<void> {
    if (!this.available || !filenames.length) return;
    await this.client.storage.from(this.bucket).remove(filenames).catch(() => {});
  }
}
