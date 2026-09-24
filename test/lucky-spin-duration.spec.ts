import { SPIN_DURATION_MS } from '../src/modules/lucky-spin/lucky-spin.constants';

describe('Lucky Spin Duration - Backend', () => {
  it('SPIN_DURATION_MS phải là 8000ms (8 giây) để đồng bộ với hiệu ứng animation bên Frontend', () => {
    expect(SPIN_DURATION_MS).toBe(8000);
  });
});
