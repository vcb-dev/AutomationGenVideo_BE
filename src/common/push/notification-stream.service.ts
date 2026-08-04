import { Injectable, MessageEvent } from "@nestjs/common";
import { Observable, Subject, interval, merge } from "rxjs";
import { filter, map } from "rxjs/operators";

// Ping định kỳ giữ kết nối SSE sống qua reverse proxy (Railway đóng connection idle).
const HEARTBEAT_MS = 20_000;

/**
 * Bus real-time dùng chung cho mọi kênh "báo cho user X ngay bây giờ" (SSE hiện tại,
 * có thể thêm kênh khác sau). Một Subject duy nhất cho cả app, lọc theo userId ở phía
 * subscribe — tránh phải tự quản lý vòng đời Subject theo từng user/tab.
 */
@Injectable()
export class NotificationStreamService {
  private readonly subject = new Subject<{ userId: string; event: MessageEvent }>();

  emit(userId: string, data: object = {}): void {
    this.subject.next({ userId, event: { type: "notification", data } });
  }

  emitMany(userIds: string[], data: object = {}): void {
    Array.from(new Set(userIds)).forEach((id) => this.emit(id, data));
  }

  stream(userId: string): Observable<MessageEvent> {
    const events$ = this.subject.asObservable().pipe(
      filter((e) => e.userId === userId),
      map((e) => e.event),
    );
    const heartbeat$ = interval(HEARTBEAT_MS).pipe(
      map((): MessageEvent => ({ type: "ping", data: {} })),
    );
    return merge(events$, heartbeat$);
  }
}
