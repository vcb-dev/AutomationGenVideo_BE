import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import * as FormData from 'form-data';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as jwt from 'jsonwebtoken';

const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';
const DRIVE_API_URL = 'https://www.googleapis.com/drive/v3/files';
const METADATA_TOKEN_URL = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';

// Douyin CDN — một số node chỉ accessible từ IP Trung Quốc, cần browser headers giả
// + timeout ngắn hơn để không giữ job cron quá lâu khi chúng fail.
const CHINA_CDN_DOMAINS = ['douyinpic.com', 'bytecdn.cn', 'ibyteimg.com', 'douyinstatic.com', 'douyinvod.com'];
const CHINA_CDN_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9',
  'Referer': 'https://www.douyin.com/',
};

interface GoogleServiceAccountCredentials {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

export interface GoogleDriveUploadResult {
  fileId: string;
  url: string;
  webViewUrl: string;
}

export interface GoogleDriveFileMetadata {
  fileId: string;
  name: string;
  mimetype: string;
  size: number;
  url: string;
  webViewUrl?: string;
  thumbnailUrl?: string;
}

export interface GoogleDriveResumableStatus {
  uploadedBytes: number;
  completed: boolean;
  fileId?: string;
}

@Injectable()
export class GoogleDriveStorageService {
  private readonly logger = new Logger(GoogleDriveStorageService.name);
  private cachedToken: { token: string; expiresAt: number } | null = null;
  private tokenPending: Promise<string> | null = null;
  private folderCache = new Map<string, string>();

  isAvailable(): boolean {
    const hasAuth =
      this.hasServiceAccountCredentials() ||
      !!process.env.GOOGLE_DRIVE_REFRESH_TOKEN ||
      process.env.GOOGLE_DRIVE_USE_METADATA === 'true' ||
      !!process.env.K_SERVICE; // Auto-detect Cloud Run (uses metadata token automatically)

    return (
      process.env.COMPANY_DRIVE_PROVIDER === 'google' &&
      !!process.env.GOOGLE_DRIVE_FOLDER_ID &&
      hasAuth
    );
  }

  async resolveTargetFolder(user?: any, subfolder?: string): Promise<string> {
    const rootFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID!;
    // Use Vietnam timezone (ICT, UTC+7) for folder date to match business hours
    const dateStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });

    // 1. Get or create Date folder
    const dateFolderId = await this.getOrCreateFolder(rootFolderId, dateStr);

    // 2. Get or create User folder if user info is available
    if (user && (user.full_name || user.email)) {
      const folderName = user.full_name || user.email;
      const userFolderId = await this.getOrCreateFolder(dateFolderId, folderName);
      return subfolder ? this.getOrCreateFolder(userFolderId, subfolder) : userFolderId;
    }

    return subfolder ? this.getOrCreateFolder(dateFolderId, subfolder) : dateFolderId;
  }

  /** Cây folder gom file theo LOẠI thay vì theo ngày: Root/{name}/{YYYY-MM-DD}/
   * Dùng cho các file không gắn với user (audio TTS, ảnh cào...) để tất cả file
   * cùng loại nằm chung 1 nơi, bên trong mới chia theo ngày — thay vì rải mỗi
   * folder ngày một ít như resolveTargetFolder. */
  async resolveDatedFolder(name: string): Promise<string> {
    const rootFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID!;
    const typeFolderId = await this.getOrCreateFolder(rootFolderId, name);
    const dateStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
    return this.getOrCreateFolder(typeFolderId, dateStr);
  }

  private static readonly SCRAPER_ROOT_FOLDER_NAME = 'Scraper Cào Dữ Liệu';

  /** Cây folder RIÊNG cho ảnh cào dữ liệu: Root/Scraper Cào Dữ Liệu/{Platform}/{YYYY-MM-DD}/
   * Không đụng tới resolveTargetFolder ở trên (vẫn dùng nguyên cho luồng publish
   * video, tổ chức theo user) — ảnh cào không gắn với user nào nên nhóm theo
   * platform trước để dễ duyệt riêng từng nền tảng, mỗi platform tự giới hạn
   * quy mô theo ngày thay vì dồn chung 1 folder ngày như trước. */
  async resolveScraperFolder(platform: string): Promise<string> {
    const rootFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID!;
    const scraperRootId = await this.getOrCreateFolder(rootFolderId, GoogleDriveStorageService.SCRAPER_ROOT_FOLDER_NAME);
    const platformFolderId = await this.getOrCreateFolder(scraperRootId, platform);
    const dateStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
    return this.getOrCreateFolder(platformFolderId, dateStr);
  }

  private folderPending = new Map<string, Promise<string>>();

  async getOrCreateFolder(parentFolderId: string, folderName: string): Promise<string> {
    const cacheKey = `${parentFolderId}:${folderName}`;
    if (this.folderCache.has(cacheKey)) {
      return this.folderCache.get(cacheKey)!;
    }

    // Prevent race condition: if another request is already creating this folder, wait for it
    if (this.folderPending.has(cacheKey)) {
      return this.folderPending.get(cacheKey)!;
    }

    const promise = this._doGetOrCreateFolder(parentFolderId, folderName, cacheKey);
    this.folderPending.set(cacheKey, promise);
    try {
      return await promise;
    } finally {
      this.folderPending.delete(cacheKey);
    }
  }

  private async _doGetOrCreateFolder(parentFolderId: string, folderName: string, cacheKey: string): Promise<string> {
    const token = await this.getAccessToken();

    try {
      // 1. Search if folder already exists
      const searchRes = await axios.get(DRIVE_API_URL, {
        headers: { Authorization: `Bearer ${token}` },
        params: {
          q: `mimeType='application/vnd.google-apps.folder' and name='${folderName.replace(/'/g, "\\'")}' and '${parentFolderId}' in parents and trashed=false`,
          fields: 'files(id)',
          spaces: 'drive',
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
        },
        timeout: 10_000,
      });

      if (searchRes.data.files && searchRes.data.files.length > 0) {
        const folderId = searchRes.data.files[0].id;
        this.folderCache.set(cacheKey, folderId);
        return folderId;
      }

      // 2. Create the folder
      const createRes = await axios.post(DRIVE_API_URL, {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentFolderId],
      }, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        params: { supportsAllDrives: true },
        timeout: 10_000,
      });

      const newFolderId = createRes.data.id;
      this.logger.log(`[GoogleDrive] Created folder '${folderName}' -> ${newFolderId}`);
      this.folderCache.set(cacheKey, newFolderId);
      return newFolderId;
    } catch (err: any) {
      const status = err.response?.status;
      const msg = err.response?.data?.error?.message || err.message;
      this.logger.error(`[GoogleDrive] Failed to get/create folder '${folderName}' in ${parentFolderId}: ${status} ${msg}`);
      throw new Error(`Google Drive folder error (${status || 'unknown'}): ${msg}`);
    }
  }

  async uploadFromPath(
    filePath: string,
    filename: string,
    mimetype: string,
    user?: any,
    opts?: { subfolder?: string; displayName?: string; folderId?: string },
  ): Promise<GoogleDriveUploadResult> {
    if (!this.isAvailable()) {
      throw new Error('Google Drive storage is not configured');
    }

    const driveName = opts?.displayName || filename;
    // folderId override — dùng cho luồng ảnh cào dữ liệu (resolveScraperFolder),
    // bỏ qua resolveTargetFolder (vốn dành cho luồng publish video theo user).
    const folderId = opts?.folderId ?? (await this.resolveTargetFolder(user, opts?.subfolder));
    const token = await this.getAccessToken();
    const fileSize = fs.statSync(filePath).size;

    // Drive multipart upload is capped at 5 MB — use resumable for anything larger
    if (fileSize > 5 * 1024 * 1024) {
      return this._uploadLargeFileResumable(filePath, driveName, mimetype, folderId, token, fileSize);
    }

    const form = new FormData();
    form.append('metadata', JSON.stringify({
      name: driveName,
      parents: [folderId],
      mimeType: mimetype,
    }), { contentType: 'application/json' });
    form.append('media', fs.createReadStream(filePath), { filename: driveName, contentType: mimetype });

    let uploadRes: any;
    try {
      uploadRes = await axios.post(
        DRIVE_UPLOAD_URL,
        form,
        {
          headers: { ...form.getHeaders(), Authorization: `Bearer ${token}` },
          params: {
            uploadType: 'multipart',
            supportsAllDrives: true,
            fields: 'id,webViewLink,webContentLink',
          },
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
          timeout: 900_000,
        },
      );
    } catch (err: any) {
      const status = err.response?.status;
      const detail = JSON.stringify(err.response?.data ?? err.message);
      this.logger.error(`[GoogleDrive] Upload failed ${status}: ${detail} | folder=${folderId} file=${driveName}`);
      throw err;
    }

    const fileId = uploadRes.data.id as string;
    if (process.env.GOOGLE_DRIVE_PUBLIC !== 'false') {
      await this.makePublic(fileId, token);
    }

    const isImage = mimetype.startsWith('image/');
    const directUrl = isImage
      ? `https://lh3.googleusercontent.com/d/${fileId}`
      : this.buildDownloadUrl(fileId, driveName);
    this.logger.log(`[GoogleDrive] Uploaded ${driveName} -> ${fileId}`);

    return {
      fileId,
      url: directUrl,
      webViewUrl: uploadRes.data.webViewLink || this.buildViewUrl(fileId),
    };
  }

  /**
   * Tải file từ một URL rồi upload lên Drive, trả về link công khai.
   * Trả '' nếu thất bại (không throw) — caller tự fallback về URL gốc.
   */
  async uploadFromUrl(
    sourceUrl: string,
    filename: string,
    mimetype: string,
    opts?: { subfolder?: string; folderId?: string; timeoutMs?: number },
  ): Promise<string> {
    if (!sourceUrl || !this.isAvailable()) return '';

    let buffer: Buffer;
    try {
      const res = await axios.get(sourceUrl, {
        timeout: opts?.timeoutMs ?? 60_000,
        responseType: 'arraybuffer',
      });
      buffer = Buffer.from(res.data);
    } catch (err: any) {
      this.logger.warn(`[GoogleDrive] uploadFromUrl download failed (${sourceUrl.slice(0, 80)}...): ${err.message}`);
      return '';
    }
    if (!buffer.length) return '';

    const tmpPath = path.join(os.tmpdir(), `dl_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    try {
      fs.writeFileSync(tmpPath, buffer);
      const uploaded = await this.uploadFromPath(tmpPath, filename, mimetype, undefined, {
        subfolder: opts?.subfolder,
        folderId: opts?.folderId,
      });
      return uploaded.url;
    } catch (err: any) {
      this.logger.error(`[GoogleDrive] uploadFromUrl upload failed ${filename}: ${err.message}`);
      return '';
    } finally {
      try { fs.unlinkSync(tmpPath); } catch {}
    }
  }

  /** Tải ảnh thumbnail từ CDN URL bên thứ 3 rồi upload lên Drive. Trả '' nếu thất bại (không throw) — dùng cho cron nền.
   * platform (vd 'Kuaishou', 'TikTok') → upload vào Root/Scraper Cào Dữ Liệu/{platform}/{YYYY-MM-DD}/
   * thay vì folder ngày dùng chung mặc định. */
  async uploadThumbnailFromUrl(sourceUrl: string, filename: string, platform?: string): Promise<string> {
    if (!sourceUrl) return '';
    if (sourceUrl.includes('drive.google.com') || sourceUrl.includes('googleusercontent.com')) return sourceUrl;
    if (!this.isAvailable()) return '';

    const isChinaCdn = CHINA_CDN_DOMAINS.some(domain => sourceUrl.includes(domain));
    let buffer: Buffer;
    try {
      const res = await axios.get(sourceUrl, {
        headers: isChinaCdn ? CHINA_CDN_HEADERS : {},
        timeout: isChinaCdn ? 8_000 : 15_000,
        responseType: 'arraybuffer',
      });
      buffer = Buffer.from(res.data);
      const contentType = (res.headers['content-type'] || '') as string;
      if (!contentType.startsWith('image/')) {
        this.logger.warn(`[ThumbnailMigration] Expected image, got '${contentType}' from ${sourceUrl.slice(0, 80)}`);
        return '';
      }
    } catch (err: any) {
      this.logger.warn(`[ThumbnailMigration] Download failed (${sourceUrl.slice(0, 70)}...): ${err.message}`);
      return '';
    }
    if (!buffer.length) return '';

    const tmpPath = path.join(os.tmpdir(), `thumb_${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`);
    try {
      fs.writeFileSync(tmpPath, buffer);
      const folderId = platform ? await this.resolveScraperFolder(platform) : undefined;
      const uploaded = await this.uploadFromPath(tmpPath, filename, 'image/jpeg', undefined, folderId ? { folderId } : undefined);
      return uploaded.url;
    } catch (err: any) {
      this.logger.error(`[ThumbnailMigration] Upload failed ${filename}: ${err.message}`);
      return '';
    } finally {
      try { fs.unlinkSync(tmpPath); } catch {}
    }
  }

  private async _uploadLargeFileResumable(
    filePath: string,
    driveName: string,
    mimetype: string,
    folderId: string,
    token: string,
    fileSize: number,
  ): Promise<GoogleDriveUploadResult> {
    this.logger.log(`[GoogleDrive] Starting resumable upload for ${driveName} (${(fileSize / 1024 / 1024).toFixed(1)} MB)`);

    // Step 1: Initiate resumable session
    const initRes = await axios.post(
      `${DRIVE_UPLOAD_URL}?uploadType=resumable&supportsAllDrives=true`,
      { name: driveName, parents: [folderId], mimeType: mimetype },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Upload-Content-Type': mimetype,
          'X-Upload-Content-Length': String(fileSize),
        },
      },
    );

    const uploadUrl: string = initRes.headers['location'];
    if (!uploadUrl) throw new Error('[GoogleDrive] Drive did not return a resumable upload URL');

    // Step 2: Upload the full file in a single PUT to the resumable URL
    const uploadRes = await axios.put(
      uploadUrl,
      fs.createReadStream(filePath),
      {
        headers: {
          'Content-Type': mimetype,
          'Content-Length': String(fileSize),
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        timeout: 1_800_000, // 30 min for large videos
        params: { fields: 'id,webViewLink,webContentLink' },
      },
    );

    const fileId = uploadRes.data.id as string;
    if (process.env.GOOGLE_DRIVE_PUBLIC !== 'false') {
      await this.makePublic(fileId, token);
    }

    const directUrl = this.buildDownloadUrl(fileId, driveName);
    this.logger.log(`[GoogleDrive] Resumable upload complete: ${driveName} -> ${fileId}`);

    return {
      fileId,
      url: directUrl,
      webViewUrl: uploadRes.data.webViewLink || this.buildViewUrl(fileId),
    };
  }

  async createResumableUpload(filename: string, mimetype: string, size: number, user?: any, origin?: string): Promise<{ uploadUrl: string; fileId: string }> {
    if (!this.isAvailable()) {
      throw new Error('Google Drive storage is not configured');
    }

    const token = await this.getAccessToken();
    const folderId = await this.resolveTargetFolder(user);
    const reqHeaders: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': mimetype,
      'X-Upload-Content-Length': String(size),
    };
    if (origin) {
      reqHeaders['Origin'] = origin;
    }

    const res = await axios.post(
      DRIVE_UPLOAD_URL,
      {
        name: filename,
        parents: [folderId],
        mimeType: mimetype,
      },
      {
        headers: reqHeaders,
        params: {
          uploadType: 'resumable',
          supportsAllDrives: true,
          fields: 'id',
        },
        timeout: 30_000,
      },
    );

    const uploadUrl = res.headers.location as string | undefined;
    if (!uploadUrl) throw new Error('Google Drive did not return a resumable upload URL');

    this.logger.log(`[GoogleDrive] Created resumable upload for ${filename}`);
    return { uploadUrl, fileId: '' };
  }

  async downloadFileToLocal(fileId: string, outputPath: string): Promise<string> {
    if (!this.isAvailable()) {
      throw new Error('Google Drive storage is not configured');
    }

    this.logger.log(`[GoogleDrive] Downloading fileId=${fileId} to ${outputPath}`);
    const token = await this.getAccessToken();
    const res = await axios.get(`${DRIVE_API_URL}/${encodeURIComponent(fileId)}`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { alt: 'media', supportsAllDrives: true },
      responseType: 'stream',
      timeout: 300_000,
    });

    const writer = fs.createWriteStream(outputPath);
    res.data.pipe(writer);

    return new Promise((resolve, reject) => {
      const cleanup = (err: Error) => {
        try { writer.destroy(); } catch {}
        try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch {}
        reject(err);
      };
      res.data.on('error', cleanup);
      writer.on('error', cleanup);
      writer.on('finish', () => resolve(outputPath));
    });
  }

  async getFile(fileId: string, makePublic = true): Promise<GoogleDriveFileMetadata> {
    if (!this.isAvailable()) {
      throw new Error('Google Drive storage is not configured');
    }

    const token = await this.getAccessToken();
    if (makePublic && process.env.GOOGLE_DRIVE_PUBLIC !== 'false') {
      await this.makePublic(fileId, token);
    }

    const res = await axios.get(`${DRIVE_API_URL}/${encodeURIComponent(fileId)}`, {
      headers: { Authorization: `Bearer ${token}` },
      params: {
        supportsAllDrives: true,
        fields: 'id,name,mimeType,size,webViewLink,webContentLink,thumbnailLink',
      },
      timeout: 30_000,
    });

    const directUrl = this.buildDownloadUrl(fileId, res.data.name);
    const isVideo = (res.data.mimeType || '').startsWith('video/');
    // Google Drive's thumbnailLink requires auth and is often null for recently uploaded videos
    // Use public thumbnail URL instead for reliable display
    const thumbnailUrl = isVideo
      ? this.buildThumbnailUrl(fileId)
      : (res.data.thumbnailLink || this.buildThumbnailUrl(fileId));
    return {
      fileId: res.data.id,
      name: res.data.name,
      mimetype: res.data.mimeType,
      size: Number(res.data.size || 0),
      url: directUrl,
      webViewUrl: res.data.webViewLink,
      thumbnailUrl,
    };
  }

  async getResumableStatus(uploadUrl: string, totalSize: number): Promise<GoogleDriveResumableStatus> {
    try {
      const res = await axios.put(uploadUrl, null, {
        headers: {
          'Content-Length': '0',
          'Content-Range': `bytes */${totalSize}`,
        },
        validateStatus: status => status === 200 || status === 201 || status === 308,
        timeout: 30_000,
      });

      if (res.status === 200 || res.status === 201) {
        return {
          uploadedBytes: totalSize,
          completed: true,
          fileId: res.data?.id,
        };
      }

      const range = res.headers.range || res.headers.Range;
      const match = typeof range === 'string' ? range.match(/bytes=0-(\d+)/) : null;
      const uploadedBytes = match ? Number(match[1]) + 1 : 0;
      return { uploadedBytes, completed: false };
    } catch (err: any) {
      this.logger.warn(`[GoogleDrive] Could not query resumable status: ${err.message}`);
      throw err;
    }
  }

  async delete(fileId: string): Promise<void> {
    if (!fileId || !this.isAvailable()) return;
    const token = await this.getAccessToken();
    await axios.delete(`${DRIVE_API_URL}/${encodeURIComponent(fileId)}`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { supportsAllDrives: true },
      timeout: 30_000,
    });
    this.logger.log(`[GoogleDrive] Deleted ${fileId}`);
  }

  private async makePublic(fileId: string, token: string): Promise<void> {
    try {
      await axios.post(
        `${DRIVE_API_URL}/${encodeURIComponent(fileId)}/permissions`,
        { role: 'reader', type: 'anyone' },
        {
          headers: { Authorization: `Bearer ${token}` },
          params: { supportsAllDrives: true },
          timeout: 30_000,
        },
      );
    } catch (err: any) {
      const status = err.response?.status;
      const error = err.response?.data?.error;
      const reason = error?.errors?.[0]?.reason;
      if (status === 409 || reason === 'alreadyExists') {
        this.logger.log(`[GoogleDrive] Public permission already exists for ${fileId}`);
        return;
      }
      this.logger.warn(`[GoogleDrive] Could not make ${fileId} public: ${error?.message || err.message}`);
      throw err;
    }
  }

  buildDownloadUrl(fileId: string, filename?: string): string {
    const params = new URLSearchParams({
      export: 'download',
      confirm: 't',
      id: fileId,
    });
    if (filename) params.set('filename', filename);
    return `https://drive.google.com/uc?${params.toString()}`;
  }

  private buildViewUrl(fileId: string): string {
    return `https://drive.google.com/file/d/${fileId}/view`;
  }

  private buildThumbnailUrl(fileId: string): string {
    return `https://drive.google.com/thumbnail?id=${fileId}&sz=w640`;
  }

  private async getAccessToken(): Promise<string> {
    if (this.cachedToken && this.cachedToken.expiresAt > Date.now() + 60_000) {
      return this.cachedToken.token;
    }
    // Prevent concurrent token fetches: all callers wait on the same in-flight request
    if (this.tokenPending) return this.tokenPending;
    this.tokenPending = this._fetchAccessToken().finally(() => { this.tokenPending = null; });
    return this.tokenPending;
  }

  private async _fetchAccessToken(): Promise<string> {
    const serviceAccount = this.getServiceAccountCredentials();
    if (serviceAccount) {
      const nowSeconds = Math.floor(Date.now() / 1000);
      const assertion = jwt.sign(
        {
          iss: serviceAccount.client_email,
          scope: DRIVE_SCOPE,
          aud: serviceAccount.token_uri || GOOGLE_TOKEN_URL,
          iat: nowSeconds,
          exp: nowSeconds + 3600,
        },
        serviceAccount.private_key,
        { algorithm: 'RS256' },
      );

      const res = await axios.post(
        serviceAccount.token_uri || GOOGLE_TOKEN_URL,
        new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion,
        }),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 30_000,
        },
      );

      if (!res.data?.access_token) {
        throw new Error('Google token endpoint did not return an access token');
      }

      this.cachedToken = {
        token: res.data.access_token,
        expiresAt: Date.now() + Number(res.data.expires_in || 3600) * 1000,
      };
      return this.cachedToken.token;
    }

    const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
    if (refreshToken) {
      const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || process.env.OAUTH_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || process.env.OAUTH_CLIENT_SECRET;

      if (!clientId || !clientSecret) {
        throw new Error('Google Drive refresh token requires GOOGLE_DRIVE_CLIENT_ID/SECRET or GOOGLE_CLIENT_ID/SECRET');
      }

      this.logger.debug(`[GoogleDrive] Token request — client_id: ${clientId?.slice(0, 20)}... refresh_token: ${refreshToken?.slice(0, 10)}...`)
      let res: any
      try {
        res = await axios.post(
          GOOGLE_TOKEN_URL,
          new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: refreshToken,
            grant_type: 'refresh_token',
          }),
          {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 30_000,
          },
        )
      } catch (err: any) {
        this.logger.error(`[GoogleDrive] Token 401 detail: ${JSON.stringify(err.response?.data)}`)
        throw err
      }

      if (!res.data?.access_token) {
        throw new Error('Google refresh token flow did not return an access token');
      }

      this.cachedToken = {
        token: res.data.access_token,
        expiresAt: Date.now() + Number(res.data.expires_in || 3600) * 1000,
      };
      return this.cachedToken.token;
    }

    const res = await axios.get(METADATA_TOKEN_URL, {
      headers: { 'Metadata-Flavor': 'Google' },
      params: { scopes: DRIVE_SCOPE },
      timeout: 10_000,
    });
    if (!res.data?.access_token) {
      throw new Error('Google metadata server did not return an access token');
    }

    this.cachedToken = {
      token: res.data.access_token,
      expiresAt: Date.now() + Number(res.data.expires_in || 3600) * 1000,
    };
    return this.cachedToken.token;
  }

  private hasServiceAccountCredentials(): boolean {
    return !!(
      process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
      process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 ||
      process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE
    );
  }

  private getServiceAccountCredentials(): GoogleServiceAccountCredentials | null {
    const rawJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    const rawBase64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64;
    const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE;

    let jsonText: string | null = null;
    if (rawJson) {
      jsonText = rawJson;
    } else if (rawBase64) {
      jsonText = Buffer.from(rawBase64, 'base64').toString('utf8');
    } else if (keyFile && fs.existsSync(keyFile)) {
      jsonText = fs.readFileSync(keyFile, 'utf8');
    }

    if (!jsonText) return null;

    let credentials: GoogleServiceAccountCredentials;
    try {
      credentials = JSON.parse(jsonText) as GoogleServiceAccountCredentials;
    } catch (e: any) {
      throw new Error(`Google Drive: service account JSON không hợp lệ — ${e.message}`);
    }
    if (!credentials.client_email || !credentials.private_key) {
      throw new Error('Google service account credentials must include client_email and private_key');
    }

    credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
    return credentials;
  }
}
