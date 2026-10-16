import * as FormData from 'form-data';

/**
 * Ảnh gửi sang AI service dạng FILE trong multipart, không nhét base64 vào JSON: Django chặn body
 * không phải file quá DATA_UPLOAD_MAX_MEMORY_SIZE (mặc định 2,5MB) bằng RequestDataTooBig — ảnh
 * máy ảnh 8MB của media (đo 13/10) bị chặn trước khi AI kịp xử lý. Phần file trong multipart không
 * tính vào trần đó, nên không phải nâng trần cho cả AI service. Base64 còn phình thêm 33%.
 */
export interface AiImagePart {
  buffer: Buffer;
  mimetype: string;
  filename: string;
}

/** Trường gửi AI: chuỗi → trường chữ, ảnh → file; undefined → bỏ (vd ghi chú để trống). */
export type AiFormFields = Record<string, string | AiImagePart | undefined>;

export function aiImage(file: Pick<Express.Multer.File, 'buffer' | 'mimetype' | 'originalname'>): AiImagePart {
  return { buffer: file.buffer, mimetype: file.mimetype, filename: file.originalname || 'image' };
}

/**
 * FormData mới cho MỖI lần gửi — form-data là stream, đọc xong một lần là hết, nên lượt tự thử lại
 * (kết nối bị AI đóng ngang) phải dựng lại form chứ không gửi lại form cũ.
 */
export function buildAiForm(fields: AiFormFields): FormData {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (typeof value === 'string') {
      form.append(name, value);
    } else {
      form.append(name, value.buffer, { filename: value.filename, contentType: value.mimetype, knownLength: value.buffer.length });
    }
  }
  return form;
}
