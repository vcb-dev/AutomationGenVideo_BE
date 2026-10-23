import { classifyReturnAlerts } from '../return-alerts.util';

const NOW = new Date('2026-10-19T14:00:00Z');
const at = (iso: string) => new Date(iso);

describe('classifyReturnAlerts', () => {
  it('quá hạn thì tính số phút trễ', () => {
    const { overdue, expiringSoon } = classifyReturnAlerts([{ id: 'a', to_time: at('2026-10-19T12:30:00Z') }], NOW);
    expect(overdue).toEqual([{ id: 'a', to_time: at('2026-10-19T12:30:00Z'), overdue_minutes: 90 }]);
    expect(expiringSoon).toEqual([]);
  });

  it('trong vòng 2 giờ thì là sắp hết hạn, kèm số phút còn lại', () => {
    const { expiringSoon } = classifyReturnAlerts([{ id: 'b', to_time: at('2026-10-19T15:30:00Z') }], NOW);
    expect(expiringSoon[0].remaining_minutes).toBe(90);
  });

  it('đúng mép 2 giờ vẫn tính, quá mép thì bỏ qua', () => {
    const { expiringSoon } = classifyReturnAlerts(
      [
        { id: 'edge', to_time: at('2026-10-19T16:00:00Z') },
        { id: 'far', to_time: at('2026-10-19T16:01:00Z') },
      ],
      NOW,
    );
    expect(expiringSoon.map((r) => r.id)).toEqual(['edge']);
  });
});
