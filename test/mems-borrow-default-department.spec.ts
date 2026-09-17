import { buildCreateDeps, oneLine } from './support/mems-borrow-fixtures';

/**
 * Chức năng: ai cũng tạo được phiếu mượn, kể cả người chưa được gán bộ phận nào trong MEMS.
 *
 * Lỗi người dùng gặp: gửi phiếu thì nhận về "Chưa xác định được bộ phận của bạn. Nhờ quản trị gán
 * bạn vào một bộ phận trong MEMS." — nghĩa là người mới vào công ty không mượn được máy cho tới
 * khi có quản trị gán tay.
 *
 * Bộ phận trên phiếu chỉ để QUY TRÁCH NHIỆM và hiển thị: `borrow_limit` chưa được dùng ở đâu
 * trong mã nguồn, còn duyệt phiếu thì xét vai trò LEADER/MANAGER/ADMIN ở controller chứ không xét
 * leader của bộ phận. Nên chặn ở đó là khoá người dùng khỏi việc họ vốn được phép làm.
 *
 * Thứ tự tra vẫn giữ nguyên, từ chắc chắn nhất tới suy đoán; chỉ thay bước ném lỗi cuối cùng bằng
 * bộ phận mặc định.
 */

describe('Phiếu mượn — bộ phận mặc định cho người chưa được gán', () => {
  it('đã được gán thành viên MEMS thì lấy bộ phận đó, nguồn chắc chắn nhất', async () => {
    const { service, created } = buildCreateDeps({ membership: { department_id: 'dept-mems' } });

    await service.create('user-1', oneLine());

    expect(created.request.department_id).toBe('dept-mems');
  });

  it('chưa gán thành viên thì khớp team trên hồ sơ với mã hoặc tên bộ phận', async () => {
    const { service, created } = buildCreateDeps({
      membership: null,
      team: 'MEDIA',
      matchedByTeam: { id: 'dept-khop-team' },
    });

    await service.create('user-1', oneLine());

    expect(created.request.department_id).toBe('dept-khop-team');
  });

  it('không khớp team nhưng cả hệ thống chỉ có một bộ phận thì dùng luôn nó', async () => {
    const { service, created } = buildCreateDeps({
      membership: null,
      team: 'Team K2',
      matchedByTeam: null,
      departments: [{ id: 'dept-duy-nhat' }],
    });

    await service.create('user-1', oneLine());

    expect(created.request.department_id).toBe('dept-duy-nhat');
  });

  it('người chưa thuộc bộ phận nào vẫn tạo được phiếu, không còn bị chặn', async () => {
    const { service } = buildCreateDeps({
      membership: null,
      team: null,
      matchedByTeam: null,
      departments: [{ id: 'dept-1' }, { id: 'dept-2' }],
    });

    await expect(service.create('user-moi', oneLine())).resolves.toMatchObject({ id: 'req-1' });
  });

  it('tra không ra bộ phận thì tạo bộ phận mặc định và gắn phiếu vào đó', async () => {
    const { service, created } = buildCreateDeps({
      membership: null,
      team: null,
      departments: [{ id: 'dept-1' }, { id: 'dept-2' }],
    });

    await service.create('user-moi', oneLine());

    expect(created.departments).toHaveLength(1);
    expect(created.departments[0].code).toBe('UNASSIGNED');
    expect(created.request.department_id).toBe('dept-vua-tao');
  });

  it('bộ phận mặc định đã có thì dùng lại, không tạo bản ghi trùng mã', async () => {
    const { service, created } = buildCreateDeps({
      membership: null,
      team: null,
      departments: [{ id: 'dept-1' }, { id: 'dept-2' }],
      fallbackDepartment: { id: 'dept-mac-dinh-cu' },
    });

    await service.create('user-moi', oneLine());

    expect(created.departments).toHaveLength(0);
    expect(created.request.department_id).toBe('dept-mac-dinh-cu');
  });

  it('hệ thống chưa có bộ phận nào thì vẫn tạo được phiếu', async () => {
    const { service, created } = buildCreateDeps({
      membership: null,
      team: null,
      departments: [],
    });

    await service.create('user-moi', oneLine());

    expect(created.request.department_id).toBe('dept-vua-tao');
  });

  it('client tự khai departmentId thì bị bỏ qua, vẫn suy từ người đăng nhập', async () => {
    // Nhận giá trị client gửi lên nghĩa là ai cũng gán phiếu của mình cho một bộ phận bất kỳ, và
    // khi máy hỏng thì trách nhiệm rơi sai chỗ.
    const { service, created } = buildCreateDeps({ membership: { department_id: 'dept-that' } });

    await service.create('user-1', {
      ...oneLine(),
      departmentId: 'dept-client-tu-chon',
    } as any);

    expect(created.request.department_id).toBe('dept-that');
  });

  it('lấy khoá bộ phận mặc định SAU khoá model, để mọi giao dịch đi cùng một chiều', async () => {
    // Không bắt lỗi trùng mã rồi đọc lại: trong một giao dịch Postgres, câu lệnh lỗi làm HỎNG cả
    // giao dịch, đọc lại chỉ nhận thêm "current transaction is aborted". Phải xếp hàng bằng khoá
    // tư vấn trước khi đọc.
    const { service, lockKeys } = buildCreateDeps({
      membership: null,
      team: null,
      departments: [{ id: 'dept-1' }, { id: 'dept-2' }],
    });

    await service.create('user-moi', oneLine('model-1'));

    expect(lockKeys).toContain('mems:department:UNASSIGNED');
    expect(lockKeys.indexOf('mems:model:model-1')).toBeLessThan(
      lockKeys.indexOf('mems:department:UNASSIGNED'),
    );
  });

  it('tra ra được bộ phận thì không đụng tới khoá bộ phận mặc định', async () => {
    const { service, lockKeys } = buildCreateDeps({ membership: { department_id: 'dept-mems' } });

    await service.create('user-1', oneLine());

    expect(lockKeys.some((k) => k.startsWith('mems:department:'))).toBe(false);
  });
});
