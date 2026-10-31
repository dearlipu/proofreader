import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';
import { db, resetDatabase, type WordRecord } from './db/db';

const word: WordRecord = {
  id: 'apple',
  text: 'apple',
  pack: 'personal',
  meaning: 'A round fruit with firm flesh.',
  exampleSentence: 'She packed an apple for lunch.',
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

async function seedWord(): Promise<void> {
  await db.words.put(word);
  await db.wordState.put({
    wordId: word.id,
    status: 'NEW',
    intervalStep: 0,
    dueAt: new Date(0).toISOString(),
    lapses: 0,
    difficulty: 0.5,
    stability: 0,
    technique: 'typing',
    lastCorrectAt: null,
    updatedAt: new Date(0).toISOString(),
  });
}

describe('practice session', () => {
  beforeEach(async () => {
    await resetDatabase();
    await db.open();
  });

  it('records a correct answer and the completed session', async () => {
    await seedWord();
    render(<App />);

    await screen.findByRole('button', { name: /Start session/ });
    fireEvent.change(screen.getByLabelText('Practice mode'), { target: { value: 'meaning' } });
    fireEvent.click(screen.getByRole('button', { name: /Start session/ }));

    expect(await screen.findByText(word.meaning)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Your spelling'), { target: { value: 'apple' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check spelling' }));

    expect(await screen.findByRole('heading', { name: 'That’s the last word for now.' })).toBeInTheDocument();
    const reviews = await db.reviews.toArray();
    const session = await db.sessions.toCollection().first();
    const state = await db.wordState.get(word.id);

    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({ mode: 'meaning', correct: true, latencyMs: expect.any(Number) });
    expect(session).toMatchObject({ newCount: 1, reviewCount: 0, accuracy: 1 });
    expect(state?.status).toBe('WEAK');
  });

  it('lets the learner mark a typo as a slip without a lapse', async () => {
    await seedWord();
    render(<App />);

    await screen.findByRole('button', { name: /Start session/ });
    fireEvent.change(screen.getByLabelText('Practice mode'), { target: { value: 'meaning' } });
    fireEvent.click(screen.getByRole('button', { name: /Start session/ }));
    await screen.findByText(word.meaning);
    fireEvent.change(screen.getByLabelText('Your spelling'), { target: { value: 'appl' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check spelling' }));
    expect(await screen.findByLabelText('Detected spelling patterns')).toHaveTextContent('missing letter');
    fireEvent.click(await screen.findByRole('button', { name: 'I knew it — a slip' }));

    await screen.findByRole('heading', { name: 'That’s the last word for now.' });
    const review = await db.reviews.toCollection().first();
    const state = await db.wordState.get(word.id);
    const session = await db.sessions.toCollection().first();

    expect(review).toMatchObject({ correct: false, slipFlag: true, response: 'appl' });
    expect(review?.latencyMs).toBeGreaterThanOrEqual(0);
    expect(review?.errorTypes.length).toBeGreaterThan(0);
    expect(state).toMatchObject({ status: 'NEW', lapses: 0 });
    expect(session?.accuracy).toBe(0);
  });

  it('plays dictation only after the learner requests audio', async () => {
    await seedWord();
    const uttered: string[] = [];
    const speech = { cancel: vi.fn(), speak: vi.fn() };
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: speech });
    vi.stubGlobal(
      'SpeechSynthesisUtterance',
      class {
        onend: (() => void) | null = null;
        onerror: (() => void) | null = null;
        constructor(public text: string) {
          uttered.push(text);
        }
      }
    );
    const { unmount } = render(<App />);

    try {
      await screen.findByRole('button', { name: /Start session/ });
      fireEvent.change(screen.getByLabelText('Practice mode'), { target: { value: 'dictation' } });
      fireEvent.click(screen.getByRole('button', { name: /Start session/ }));
      fireEvent.click(await screen.findByRole('button', { name: 'Play word' }));

      expect(speech.cancel).toHaveBeenCalledOnce();
      expect(speech.speak).toHaveBeenCalledOnce();
      expect(uttered).toEqual(['apple']);
    } finally {
      unmount();
      Reflect.deleteProperty(window, 'speechSynthesis');
      vi.unstubAllGlobals();
    }
  });

  it('adds a personal word from the empty desk', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add your first word' }));
    fireEvent.change(screen.getByLabelText('Word'), { target: { value: 'receive' } });
    fireEvent.change(screen.getByLabelText('Meaning optional'), { target: { value: 'Get or accept.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save word' }));

    await waitFor(async () => expect(await db.words.get('receive')).toBeDefined());
    expect(await db.wordState.get('receive')).toMatchObject({ status: 'NEW' });
  });

  it('does not reset scheduling when a duplicate word is added', async () => {
    await seedWord();
    await db.wordState.update(word.id, { status: 'ACTIVE', intervalStep: 2 });
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Add a word' }));
    fireEvent.change(screen.getByLabelText('Word'), { target: { value: 'APPLE' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save word' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('already in your desk');
    expect(await db.wordState.get(word.id)).toMatchObject({ status: 'ACTIVE', intervalStep: 2 });
  });
});
