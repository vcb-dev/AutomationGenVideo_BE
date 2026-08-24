import { SPIN_DURATION_MS } from '../lucky-spin.constants';

describe('Lucky Spin Constants Synchronization', () => {
  it('should have SPIN_DURATION_MS equal to 30000ms to match frontend animation', () => {
    expect(SPIN_DURATION_MS).toBe(30000);
  });
});

