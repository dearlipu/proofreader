import { beforeEach, describe, expect, it } from 'vitest';
import { db, resetDatabase } from './db';

describe('Proofreader database', () => {
  beforeEach(async () => {
    await resetDatabase();
    await db.open();
  });

  it('stores a word and session metadata for the learning loop', async () => {
    await db.words.put({
      id: 'receive',
      text: 'receive',
      pack: 'core',
      meaning: 'get or accept something',
      exampleSentence: 'I will receive the invoice today.',
      chunks: ['re', 'ceive'],
      hardLetterRanges: [[2, 4]],
      patternTags: ['silent_letter'],
      createdAt: new Date('2024-01-01T00:00:00Z').toISOString(),
      updatedAt: new Date('2024-01-01T00:00:00Z').toISOString()
    });

    await db.wordState.put({
      wordId: 'receive',
      status: 'ACTIVE',
      intervalStep: 3,
      dueAt: new Date('2024-01-04T00:00:00Z').toISOString(),
      lapses: 1,
      difficulty: 0.6,
      stability: 10,
      technique: 'chunk-and-say',
      lastCorrectAt: new Date('2024-01-02T00:00:00Z').toISOString(),
      updatedAt: new Date('2024-01-02T00:00:00Z').toISOString()
    });

    await db.sessions.put({
      id: 'session-1',
      startedAt: new Date('2024-01-02T09:00:00Z').toISOString(),
      durationMs: 360000,
      newCount: 2,
      reviewCount: 5,
      accuracy: 0.8,
      createdAt: new Date('2024-01-02T09:00:00Z').toISOString()
    });

    const word = await db.words.get('receive');
    const wordState = await db.wordState.get('receive');
    const session = await db.sessions.get('session-1');

    expect(word?.text).toBe('receive');
    expect(wordState?.status).toBe('ACTIVE');
    expect(session?.accuracy).toBe(0.8);
  });

  it('records review metadata and settings for future review optimization', async () => {
    await db.reviews.put({
      id: 'review-1',
      wordId: 'deadline',
      at: new Date('2024-01-03T10:15:00Z').toISOString(),
      mode: 'dictation',
      prompt: 'deadline',
      response: 'dealdine',
      correct: false,
      latencyMs: 1200,
      keystrokes: [100, 180, 210, 390],
      hintUsed: false,
      slipFlag: false,
      errorTypes: ['phonetic_substitution'],
      technique: 'sound-out-then-type'
    });

    await db.settings.put({
      key: 'theme',
      value: 'paper',
      updatedAt: new Date('2024-01-03T10:18:00Z').toISOString()
    });

    const review = await db.reviews.get('review-1');
    const setting = await db.settings.get('theme');

    expect(review?.errorTypes).toContain('phonetic_substitution');
    expect(setting?.value).toBe('paper');
  });
});
