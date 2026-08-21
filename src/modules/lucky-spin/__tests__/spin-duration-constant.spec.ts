import { SPIN_DURATION_MS } from '../lucky-spin.constants';

describe('Lucky Spin Constants Synchronization', () => {
  it('should have SPIN_DURATION_MS equal to 10000ms to match frontend animation', () => {
    expect(SPIN_DURATION_MS).toBe(10000);
  });
});
