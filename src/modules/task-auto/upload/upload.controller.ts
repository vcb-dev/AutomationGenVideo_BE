import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Request,
  UseInterceptors,
  UploadedFile,
  Res,
  NotFoundException,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes } from "@nestjs/swagger";
import { Response } from "express";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { JwtAuthGuard } from "../../../common/guards/jwt-auth.guard";
import { GoogleDriveStorageService } from "../../social-publishing/upload/google-drive-storage.service";

const PRODUCT_IMAGES_DIR = path.join(process.cwd(), "uploads", "products");

@ApiTags("task-auto")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("task-auto")
export class TaskAutoUploadController {
  constructor(private googleDrive: GoogleDriveStorageService) {}

  // ── Product Images ────────────────────────────────────────────────────────

  @Post("upload-image")
  @ApiOperation({ summary: "Upload product image — returns { url }" })
  @ApiConsumes("multipart/form-data")
  @UseInterceptors(FileInterceptor("image"))
  async uploadProductImage(
    @UploadedFile() file: Express.Multer.File,
    @Request() req: any,
  ) {
    if (!file) throw new NotFoundException("No image file provided");
    const allowed = /^image\/(jpeg|png|gif|webp)$/;
    if (!allowed.test(file.mimetype))
      throw new NotFoundException("Only image files are allowed (jpg, png, gif, webp)");
    const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
    const filename = `${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`;

    if (this.googleDrive.isAvailable()) {
      const tmpPath = path.join(os.tmpdir(), filename);
      fs.writeFileSync(tmpPath, file.buffer);
      try {
        const result = await this.googleDrive.uploadFromPath(tmpPath, filename, file.mimetype, req.user, { subfolder: "products" });
        return { url: result.url, storage: "google_drive" };
      } finally {
        fs.unlink(tmpPath, () => {});
      }
    }

    if (!fs.existsSync(PRODUCT_IMAGES_DIR))
      fs.mkdirSync(PRODUCT_IMAGES_DIR, { recursive: true });
    fs.writeFileSync(path.join(PRODUCT_IMAGES_DIR, filename), file.buffer);
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    return { url: `${baseUrl}/api/task-auto/images/${filename}`, storage: "local" };
  }

  @Get("images/:filename")
  @ApiOperation({ summary: "Serve product image" })
  serveProductImage(@Param("filename") filename: string, @Res() res: Response) {
    const safeName = path.basename(filename);
    const filePath = path.join(PRODUCT_IMAGES_DIR, safeName);
    if (!fs.existsSync(filePath)) throw new NotFoundException("Image not found");
    const ext = path.extname(safeName).toLowerCase();
    const mime: Record<string, string> = {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".gif": "image/gif",
      ".webp": "image/webp",
    };
    res.setHeader("Content-Type", mime[ext] || "application/octet-stream");
    res.setHeader("Cache-Control", "public, max-age=604800");
    fs.createReadStream(filePath).pipe(res);
  }

  // ── Voice Files ───────────────────────────────────────────────────────────

  @Post("upload-voice")
  @ApiOperation({ summary: "Upload content voice file — returns { url }" })
  @ApiConsumes("multipart/form-data")
  @UseInterceptors(FileInterceptor("voice"))
  async uploadVoiceFile(
    @UploadedFile() file: Express.Multer.File,
    @Request() req: any,
  ) {
    if (!file) throw new NotFoundException("No voice file provided");
    const allowed = /^audio\/(mpeg|mp3|wav|x-wav|ogg|webm|mp4|aac|flac|x-m4a)|video\/mp4$/;
    if (!allowed.test(file.mimetype))
      throw new NotFoundException("Only audio files are allowed (mp3, wav, ogg, aac, flac, m4a)");
    const ext = path.extname(file.originalname).toLowerCase() || ".mp3";
    const filename = `${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`;

    if (this.googleDrive.isAvailable()) {
      const tmpPath = path.join(os.tmpdir(), filename);
      fs.writeFileSync(tmpPath, file.buffer);
      try {
        const result = await this.googleDrive.uploadFromPath(tmpPath, filename, file.mimetype, req.user, { subfolder: "voices" });
        return { url: result.url, storage: "google_drive" };
      } finally {
        fs.unlink(tmpPath, () => {});
      }
    }

    const voiceDir = path.join(process.cwd(), "uploads", "voices");
    if (!fs.existsSync(voiceDir)) fs.mkdirSync(voiceDir, { recursive: true });
    fs.writeFileSync(path.join(voiceDir, filename), file.buffer);
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    return { url: `${baseUrl}/api/task-auto/voices/${filename}`, storage: "local" };
  }

  @Get("voices/:filename")
  @ApiOperation({ summary: "Serve voice file" })
  serveVoiceFile(@Param("filename") filename: string, @Res() res: Response) {
    const safeName = path.basename(filename);
    const filePath = path.join(process.cwd(), "uploads", "voices", safeName);
    if (!fs.existsSync(filePath)) throw new NotFoundException("Voice file not found");
    const ext = path.extname(safeName).toLowerCase();
    const mime: Record<string, string> = {
      ".mp3": "audio/mpeg",
      ".wav": "audio/wav",
      ".ogg": "audio/ogg",
      ".aac": "audio/aac",
      ".flac": "audio/flac",
      ".m4a": "audio/mp4",
      ".webm": "audio/webm",
    };
    res.setHeader("Content-Type", mime[ext] || "audio/mpeg");
    res.setHeader("Cache-Control", "public, max-age=604800");
    res.setHeader("Accept-Ranges", "bytes");
    fs.createReadStream(filePath).pipe(res);
  }

  // ── Content Files ─────────────────────────────────────────────────────────

  @Post("upload-content")
  @ApiOperation({ summary: "Upload content file (PDF, Word, Excel…) — returns { url }" })
  @ApiConsumes("multipart/form-data")
  @UseInterceptors(FileInterceptor("file"))
  async uploadContentFile(
    @UploadedFile() file: Express.Multer.File,
    @Request() req: any,
  ) {
    if (!file) throw new NotFoundException("No file provided");
    const ALLOWED_MIME = [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "text/plain",
    ];
    if (!ALLOWED_MIME.includes(file.mimetype))
      throw new NotFoundException("Chỉ chấp nhận PDF, Word, Excel, PowerPoint, TXT");
    const ext = path.extname(file.originalname).toLowerCase() || ".pdf";
    const filename = `${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`;

    if (this.googleDrive.isAvailable()) {
      const tmpPath = path.join(os.tmpdir(), filename);
      fs.writeFileSync(tmpPath, file.buffer);
      try {
        const result = await this.googleDrive.uploadFromPath(tmpPath, filename, file.mimetype, req.user, { subfolder: "content-files" });
        return { url: result.url, storage: "google_drive" };
      } finally {
        fs.unlink(tmpPath, () => {});
      }
    }

    const contentDir = path.join(process.cwd(), "uploads", "content-files");
    if (!fs.existsSync(contentDir)) fs.mkdirSync(contentDir, { recursive: true });
    fs.writeFileSync(path.join(contentDir, filename), file.buffer);
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    return { url: `${baseUrl}/api/task-auto/content-files/${filename}`, storage: "local" };
  }

  @Get("content-files/:filename")
  @ApiOperation({ summary: "Serve content file" })
  serveContentFile(@Param("filename") filename: string, @Res() res: Response) {
    const safeName = path.basename(filename);
    const filePath = path.join(process.cwd(), "uploads", "content-files", safeName);
    if (!fs.existsSync(filePath)) throw new NotFoundException("File not found");
    const ext = path.extname(safeName).toLowerCase();
    const mime: Record<string, string> = {
      ".pdf": "application/pdf",
      ".doc": "application/msword",
      ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ".xls": "application/vnd.ms-excel",
      ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ".ppt": "application/vnd.ms-powerpoint",
      ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      ".txt": "text/plain",
    };
    res.setHeader("Content-Type", mime[ext] || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${safeName}"`);
    res.setHeader("Cache-Control", "public, max-age=604800");
    fs.createReadStream(filePath).pipe(res);
  }
}
