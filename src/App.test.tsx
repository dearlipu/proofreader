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

  it('shows a technique recommendation and stores the learner’s selected ritual', async () => {
    await seedWord();
    render(<App />);

    await screen.findByRole('button', { name: /Start session/ });
    fireEvent.change(screen.getByLabelText('Practice mode'), { target: { value: 'meaning' } });
    fireEvent.click(screen.getByRole('button', { name: /Start session/ }));

    expect(await screen.findByText('Hear the word before you type it.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Common habits to revisit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Ways to approach a miss' })).not.toBeInTheDocument();
    expect(screen.queryByText('What works for you')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Command palette' })).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }));
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Drawers' }));
    expect(await screen.findByRole('heading', { name: 'Common habits to revisit' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ways to approach a miss' })).toBeInTheDocument();
    expect(await screen.findByText('What works for you')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }));
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));

    fireEvent.click(screen.getByRole('button', { name: 'Pattern first' }));
    fireEvent.change(screen.getByLabelText('Your spelling'), { target: { value: 'apple' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check spelling' }));

    await waitFor(async () => {
      const review = await db.reviews.toCollection().first();
      expect(review).toMatchObject({ technique: 'pattern-first', correct: true });
    });
  });

  it('persists reading comfort selections for the desk', async () => {
    render(<App />);

    await screen.findByRole('button', { name: 'Open navigation menu' });
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }));
    fireEvent.click(screen.getByRole('button', { name: 'Desk' }));
    fireEvent.click(screen.getByRole('button', { name: 'A+' }));
    fireEvent.click(screen.getByLabelText('High contrast'));

    await waitFor(async () => {
      const settings = await db.settings.get('readingComfort');
      expect(settings).toMatchObject({
        key: 'readingComfort',
        value: expect.objectContaining({ fontScale: 1.15, highContrast: true }),
      });
    });
  });

  it('adds a curated seed pack to the desk', async () => {
    render(<App />);

    await screen.findByRole('button', { name: 'Open navigation menu' });
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }));
    fireEvent.click(screen.getByRole('button', { name: 'Desk' }));
    fireEvent.click(screen.getByRole('button', { name: /Add everyday words pack/i }));

    await waitFor(async () => {
      const stored = await db.words.get('because');
      expect(stored).toMatchObject({ pack: 'everyday-words', text: 'because' });
    });
  });

  it('shows a progress snapshot in the today view', async () => {
    await db.reviews.put({
      id: 'review-1',
      wordId: word.id,
      at: new Date().toISOString(),
      mode: 'meaning',
      prompt: word.meaning,
      response: word.text,
      correct: true,
      latencyMs: 300,
      keystrokes: [100],
      hintUsed: false,
      slipFlag: false,
      errorTypes: [],
      technique: 'say-it-aloud',
    });

    render(<App />);

    expect(await screen.findByText('Progress')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Desk momentum' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /words in the desk/ })).not.toBeInTheDocument();
    const dateLabel = screen.getByText(/^\d{2} [A-Z]+ \d{2}$/);
    const todayCard = dateLabel.closest('article');
    expect(dateLabel).toBeInTheDocument();
    expect(todayCard?.querySelector('.overview-card-heading')?.contains(dateLabel)).toBe(true);
    expect(todayCard?.querySelector('.today-summary')?.children).toHaveLength(3);
    expect(todayCard?.querySelector('.today-summary')?.previousElementSibling).toBe(
      todayCard?.querySelector('.overview-card-heading'),
    );
    expect(screen.getByText('Today’s reviews')).toBeInTheDocument();
    expect(screen.getByText('1 done · 0 due')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Today’s review progress' })).toHaveAttribute('aria-valuenow', '100');
    expect(screen.getByRole('heading', { name: 'Proofreader' })).toBeInTheDocument();
    expect(screen.queryByText('Spelling practice')).not.toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(screen.getByText('1 days')).toBeInTheDocument();
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
