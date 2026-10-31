export type WordState = 'NEW' | 'WEAK' | 'ACTIVE' | 'MASTERED';
export type ReviewOutcome = 'correct' | 'incorrect' | 'slip';
export type ReviewMode = 'dictation' | 'meaning' | 'cloze' | 'recognition' | 'typing' | 'pattern';

export interface SchedulerResult {
  state: WordState;
  intervalDays: number;
  dueAt: number;
  nextStep: number;
  requiresTechniqueChange: boolean;
}

export interface ReviewEvent {
  at: number;
  correct: boolean;
  hintUsed: boolean;
  mode: ReviewMode;
}

const STATE_INDEX: Record<WordState, number> = {
  NEW: 0,
  WEAK: 1,
  ACTIVE: 2,
  MASTERED: 3,
};

const LADDER_DAYS = [0.00694, 1, 3, 7, 16, 35, 90];
const DAY_IN_MS = 24 * 60 * 60 * 1000;

function localDayStamp(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function resolveIntervalForState(targetState: WordState): number {
  const index = STATE_INDEX[targetState];
  return LADDER_DAYS[Math.min(index, LADDER_DAYS.length - 1)];
}

export const Scheduler = {
  next(state: WordState, outcome: ReviewOutcome, now: number = Date.now()): SchedulerResult {
    const index = STATE_INDEX[state];

    if (outcome === 'slip') {
      return {
        state,
        intervalDays: resolveIntervalForState(state),
        dueAt: now,
        nextStep: index,
        requiresTechniqueChange: false,
      };
    }

    if (outcome === 'correct') {
      if (state === 'NEW') {
        return {
          state: 'WEAK',
          intervalDays: LADDER_DAYS[0],
          dueAt: now + LADDER_DAYS[0] * DAY_IN_MS,
          nextStep: 1,
          requiresTechniqueChange: false,
        };
      }

      if (state === 'WEAK') {
        return {
          state: 'ACTIVE',
          intervalDays: LADDER_DAYS[1],
          dueAt: now + LADDER_DAYS[1] * DAY_IN_MS,
          nextStep: 2,
          requiresTechniqueChange: false,
        };
      }

      if (state === 'MASTERED') {
        return {
          state: 'MASTERED',
          intervalDays: LADDER_DAYS[6],
          dueAt: now + LADDER_DAYS[6] * DAY_IN_MS,
          nextStep: 6,
          requiresTechniqueChange: false,
        };
      }

      return {
        state: 'ACTIVE',
        intervalDays: LADDER_DAYS[2],
        dueAt: now + LADDER_DAYS[2] * DAY_IN_MS,
        nextStep: 2,
        requiresTechniqueChange: false,
      };
    }

    const nextIndex = Math.max(index - 2, 0);
    const nextState: WordState = nextIndex === 0 ? 'NEW' : nextIndex === 1 ? 'WEAK' : 'ACTIVE';
    const intervalDays = resolveIntervalForState(nextState);

    return {
      state: nextState,
      intervalDays,
      dueAt: now + intervalDays * DAY_IN_MS,
      nextStep: nextIndex,
      requiresTechniqueChange: false,
    };
  },

  techniqueChangeRequired(consecutiveMisses: number): boolean {
    return consecutiveMisses >= 3;
  },

  shouldPrioritizeReviews(accuracyOfLastThreeSessions: number): boolean {
    return accuracyOfLastThreeSessions < 0.7;
  },

  isMastered(reviews: ReviewEvent[], now: number = Date.now()): boolean {
    if (reviews.length < 3) {
      return false;
    }

    const successfulReviews = reviews.filter((review) => review.correct).sort((a, b) => a.at - b.at);
    if (successfulReviews.length < 3) {
      return false;
    }

    const differentDays = new Set(successfulReviews.map((review) => localDayStamp(review.at))).size;
    const lastSuccess = successfulReviews[successfulReviews.length - 1];
    const priorSuccess = successfulReviews[Math.max(successfulReviews.length - 2, 0)];
    const lastIntervalDays = (lastSuccess.at - priorSuccess.at) / DAY_IN_MS;

    const hasNoHintRecall = successfulReviews.some((review) => !review.hintUsed);
    const hasSentenceOrDictationRecall = successfulReviews.some(
      (review) => review.mode === 'dictation' || review.mode === 'typing' || review.mode === 'cloze'
    );

    const elapsedSinceLastSuccess = (now - lastSuccess.at) / DAY_IN_MS;

    return (
      differentDays >= 3 &&
      lastIntervalDays >= 7 &&
      hasNoHintRecall &&
      hasSentenceOrDictationRecall &&
      elapsedSinceLastSuccess >= 7
    );
  },
};

export function isMastered(state: WordState): boolean {
  return state === 'MASTERED';
}
