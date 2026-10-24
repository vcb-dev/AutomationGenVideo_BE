import * as FormData from 'form-data';

/** Một phần file trong multipart gửi AI: nội dung (utf8) + content-type. */
export interface FormFile {
  file: string;
  contentType: string;
}

/**
 * Đọc lại FormData BE gửi AI service thành object { tên trường: chuỗi | FormFile } để test so sánh
 * đúng trường/đúng file như khi còn gửi JSON.
 */
export function formFields(form: FormData): Record<string, string | FormFile> {
  expect(form).toBeInstanceOf(FormData);
  const boundary = form.getBoundary();
  const raw = form.getBuffer().toString('utf8');
  const fields: Record<string, string | FormFile> = {};
  for (const part of raw.split(`--${boundary}`)) {
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd < 0) continue;
    const headers = part.slice(0, headerEnd);
    const body = part.slice(headerEnd + 4).replace(/\r\n$/, '');
    const name = /name="([^"]+)"/.exec(headers)?.[1];
    if (!name) continue;
    const contentType = /Content-Type: ([^\r\n]+)/i.exec(headers)?.[1];
    fields[name] = /filename="/.test(headers) ? { file: body, contentType: contentType ?? '' } : body;
  }
  return fields;
}
