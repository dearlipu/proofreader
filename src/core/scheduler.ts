export type WordState = 'NEW' | 'WEAK' | 'ACTIVE' | 'MASTERED';
export type ReviewOutcome = 'correct' | 'incorrect' | 'slip';

export interface SchedulerResult {
  state: WordState;
  intervalDays: number;
  dueAt: number;
  nextStep: number;
}

const STATE_INDEX: Record<WordState, number> = {
  NEW: 0,
  WEAK: 1,
  ACTIVE: 2,
  MASTERED: 3,
};

const LADDER_DAYS = [0.00694, 1, 3, 7, 16, 35, 90];

export const Scheduler = {
  next(state: WordState, outcome: ReviewOutcome, now: number = Date.now()): SchedulerResult {
    const index = STATE_INDEX[state];

    if (outcome === 'slip') {
      return {
        state,
        intervalDays: Math.max(0, LADDER_DAYS[Math.min(index, LADDER_DAYS.length - 1)]),
        dueAt: now,
        nextStep: index,
      };
    }

    if (outcome === 'correct') {
      const nextIndex = Math.min(index + 1, STATE_INDEX.MASTERED);
      const nextState: WordState =
        nextIndex === STATE_INDEX.MASTERED ? 'MASTERED' : index === 0 ? 'WEAK' : 'ACTIVE';
      const intervalDays = LADDER_DAYS[Math.min(nextIndex, LADDER_DAYS.length - 1)];

      return {
        state: nextState,
        intervalDays,
        dueAt: now + intervalDays * 24 * 60 * 60 * 1000,
        nextStep: nextIndex,
      };
    }

    const nextIndex = Math.max(index - 2, STATE_INDEX.NEW);
    const nextState: WordState =
      nextIndex === STATE_INDEX.NEW ? 'NEW' : nextIndex === STATE_INDEX.WEAK ? 'WEAK' : 'ACTIVE';
    const intervalDays = LADDER_DAYS[Math.min(nextIndex, LADDER_DAYS.length - 1)];

    return {
      state: nextState,
      intervalDays,
      dueAt: now + intervalDays * 24 * 60 * 60 * 1000,
      nextStep: nextIndex,
    };
  },
};

export function isMastered(state: WordState): boolean {
  return state === 'MASTERED';
}
