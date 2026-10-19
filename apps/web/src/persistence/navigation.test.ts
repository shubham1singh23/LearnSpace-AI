import { describe, expect, it } from 'vitest';
import { leaveAfterSave } from './navigation';
describe('Phase 7 navigation gate', () => {
  it('freezes editing and awaits the complete queue before route transition', async () => {
    const order: string[] = []; let dirty = true;
    await leaveAfterSave({ freeze: value => order.push(`freeze:${value}`), dirty: () => dirty, flush: async () => { order.push('flush'); await Promise.resolve(); dirty = false; order.push('acknowledged'); } }, () => { order.push('navigate'); });
    expect(order).toEqual(['freeze:true', 'flush', 'acknowledged', 'navigate']);
  });
  it('blocks navigation and unfreezes the editor on failures or newer unsaved edits', async () => {
    let navigated = false; const frozen: boolean[] = [];
    for (const flush of [async () => { throw new Error('DB unavailable'); }, async () => undefined]) {
      await expect(leaveAfterSave({ freeze: value => frozen.push(value), dirty: () => true, flush }, () => { navigated = true; })).rejects.toThrow();
    }
    expect(navigated).toBe(false); expect(frozen).toEqual([true, false, true, false]);
  });
});
