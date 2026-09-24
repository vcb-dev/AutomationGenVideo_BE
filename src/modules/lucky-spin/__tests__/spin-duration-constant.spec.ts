import { SPIN_DURATION_MS } from '../lucky-spin.constants';

describe('Lucky Spin Constants Synchronization', () => {
  it('should have SPIN_DURATION_MS equal to 8000ms (8s) to match frontend animation', () => {
    expect(SPIN_DURATION_MS).toBe(8000);
  });
});

