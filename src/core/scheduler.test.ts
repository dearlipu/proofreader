import { describe, expect, it } from 'vitest';
import { Scheduler } from './scheduler';

describe('Scheduler.next', () => {
  it('moves a new word to weak on a correct recall', () => {
    const result = Scheduler.next('NEW', 'correct', 0);
    expect(result.state).toBe('WEAK');
    expect(result.intervalDays).toBe(1);
    expect(result.nextStep).toBe(1);
  });

  it('keeps a miss from dropping below NEW', () => {
    const result = Scheduler.next('NEW', 'incorrect', 0);
    expect(result.state).toBe('NEW');
    expect(result.nextStep).toBe(0);
  });

  it('resets a miss by two steps without going below NEW', () => {
    const result = Scheduler.next('ACTIVE', 'incorrect', 0);
    expect(result.state).toBe('NEW');
    expect(result.nextStep).toBe(0);
  });

  it('marks a slip without changing state', () => {
    const result = Scheduler.next('WEAK', 'slip', 0);
    expect(result.state).toBe('WEAK');
    expect(result.dueAt).toBe(0);
  });
});
