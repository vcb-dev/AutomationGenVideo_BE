import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import * as FormData from 'form-data';
import * as fs from 'fs';
import * as jwt from 'jsonwebtoken';

const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';
const DRIVE_API_URL = 'https://www.googleapis.com/drive/v3/files';
const METADATA_TOKEN_URL = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';

interface GoogleServiceAccountCredentials {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

export interface GoogleDriveUploadResult {
  fileId: string;
  url: string;
  webViewUrl?: string;
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

  async resolveTargetFolder(user?: any): Promise<string> {
    const rootFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID!;
    // Use Vietnam timezone (ICT, UTC+7) for folder date to match business hours
    const dateStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });

    // 1. Get or create Date folder
    const dateFolderId = await this.getOrCreateFolder(rootFolderId, dateStr);

    // 2. Get or create User folder if user info is available
    if (user && (user.full_name || user.email)) {
      const folderName = user.full_name || user.email;
      const userFolderId = await this.getOrCreateFolder(dateFolderId, folderName);
      return userFolderId;
    }

    return dateFolderId;
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

  async uploadFromPath(filePath: string, filename: string, mimetype: string, user?: any): Promise<GoogleDriveUploadResult> {
    if (!this.isAvailable()) {
      throw new Error('Google Drive storage is not configured');
    }

    const folderId = await this.resolveTargetFolder(user);
    const token = await this.getAccessToken();

    const form = new FormData();
    form.append('metadata', JSON.stringify({
      name: filename,
      parents: [folderId],
      mimeType: mimetype,
    }), { contentType: 'application/json' });
    form.append('media', fs.createReadStream(filePath), { filename, contentType: mimetype });

    const uploadRes = await axios.post(
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

    const fileId = uploadRes.data.id as string;
    if (process.env.GOOGLE_DRIVE_PUBLIC !== 'false') {
      await this.makePublic(fileId, token);
    }

    const directUrl = this.buildDownloadUrl(fileId, filename);
    this.logger.log(`[GoogleDrive] Uploaded ${filename} -> ${fileId}`);

    return {
      fileId,
      url: directUrl,
      webViewUrl: uploadRes.data.webViewLink,
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

  private buildDownloadUrl(fileId: string, filename?: string): string {
    const params = new URLSearchParams({
      export: 'download',
      id: fileId,
    });
    if (filename) params.set('filename', filename);
    return `https://drive.google.com/uc?${params.toString()}`;
  }

  private buildThumbnailUrl(fileId: string): string {
    return `https://drive.google.com/thumbnail?id=${fileId}&sz=w640`;
  }

  private async getAccessToken(): Promise<string> {
    if (this.cachedToken && this.cachedToken.expiresAt > Date.now() + 60_000) {
      return this.cachedToken.token;
    }

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

      const res = await axios.post(
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
      );

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

    const credentials = JSON.parse(jsonText) as GoogleServiceAccountCredentials;
    if (!credentials.client_email || !credentials.private_key) {
      throw new Error('Google service account credentials must include client_email and private_key');
    }

    credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
    return credentials;
  }
}
