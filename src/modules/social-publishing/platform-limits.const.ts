/**
 * Giới hạn do nền tảng quy định, khai báo một chỗ.
 *
 * Khác với các nút tinh chỉnh vận hành (concurrency, timeout — thuộc về hạ tầng
 * và điều chỉnh bằng biến môi trường), đây là hằng số hợp đồng: chúng chỉ đổi
 * khi Meta hoặc Google đổi docs. Vì vậy để trong code kèm ngày đối chiếu, không
 * đưa ra env — env hoá chúng chỉ tạo ảo tưởng là có thể nới giới hạn.
 *
 * Đối chiếu docs ngày 29/08/2026.
 */

/**
 * Số media tối đa trong một bài carousel. Cùng con số cho Facebook, Instagram
 * và Threads. Trước đây không được kiểm ở đâu: gửi 11 ảnh thì nền tảng từ chối
 * giữa chừng, để lại ảnh mồ côi, và người dùng chỉ thấy lỗi khó hiểu.
 */
export const CAROUSEL_MAX_ITEMS = 10;

/** Độ dài tối đa của tiêu đề YouTube */
export const YOUTUBE_TITLE_MAX_LENGTH = 100;
