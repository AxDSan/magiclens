import { describe, expect, it, vi } from 'vitest';
import { createUpdateGate } from '../../src/background/updates';

describe('createUpdateGate', () => {
  it('applies a downloaded update immediately when no job is running', () => {
    const reload = vi.fn();
    createUpdateGate(() => false, reload).available();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('waits for the last running job before applying', () => {
    let jobs = 2;
    const reload = vi.fn();
    const gate = createUpdateGate(() => jobs > 0, reload);
    gate.available();
    jobs = 1;
    gate.settled();
    expect(reload).not.toHaveBeenCalled();
    jobs = 0;
    gate.settled();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('never reloads when no update is pending', () => {
    const reload = vi.fn();
    const gate = createUpdateGate(() => false, reload);
    gate.settled();
    expect(reload).not.toHaveBeenCalled();
  });
});
