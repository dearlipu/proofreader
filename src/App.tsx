import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { buildRedPencilDiff, classifyError } from './core/classifier';
import { Scheduler, type ReviewMode, type ReviewOutcome, type WordState } from './core/scheduler';
import {
  db,
  type ReviewRecord,
  type SessionRecord,
  type WordRecord,
  type WordStateRecord,
} from './db/db';

type PracticeWord = {
  word: WordRecord;
  state: WordStateRecord;
};

type PendingAnswer = {
  response: string;
  latencyMs: number;
  keystrokes: number[];
};

type SessionProgress = {
  correct: number;
  incorrect: number;
  slips: number;
  newCount: number;
  reviewCount: number;
};

const MODES: Array<{ value: ReviewMode; label: string }> = [
  { value: 'typing', label: 'Study, hide, spell' },
  { value: 'dictation', label: 'Dictation' },
  { value: 'meaning', label: 'Meaning' },
  { value: 'cloze', label: 'Sentence blank' },
  { value: 'recognition', label: 'Choose the spelling' },
  { value: 'pattern', label: 'Spelling pattern' },
];

function createWordState(wordId: string, now: number): WordStateRecord {
  return {
    wordId,
    status: 'NEW',
    intervalStep: 0,
    dueAt: new Date(now).toISOString(),
    lapses: 0,
    difficulty: 0.5,
    stability: 0,
    technique: 'typing',
    lastCorrectAt: null,
    updatedAt: new Date(now).toISOString(),
  };
}

function sentenceWithBlank(sentence: string, word: string): string {
  const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return sentence.replace(new RegExp(escapedWord, 'i'), '_____');
}

function normalizeAnswer(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function shuffle<T>(values: T[]): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function getPromptText(word: WordRecord, mode: ReviewMode): string {
  switch (mode) {
    case 'typing':
      return 'Study the word, hide it, then spell it from memory.';
    case 'dictation':
      return `Dictation: ${word.text}`;
    case 'meaning':
      return word.meaning || 'Spell the word from memory.';
    case 'cloze':
      return sentenceWithBlank(word.exampleSentence, word.text);
    case 'recognition':
      return 'Choose the spelling you remember.';
    case 'pattern':
      return word.patternTags?.join(' · ') || 'Recall the spelling pattern.';
  }
}

export default function App() {
  const [library, setLibrary] = useState<PracticeWord[]>([]);
  const [mode, setMode] = useState<ReviewMode>('typing');
  const [sessionQueue, setSessionQueue] = useState<PracticeWord[]>([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const [active, setActive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [response, setResponse] = useState('');
  const [pendingAnswer, setPendingAnswer] = useState<PendingAnswer | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [progress, setProgress] = useState<SessionProgress>({
    correct: 0,
    incorrect: 0,
    slips: 0,
    newCount: 0,
    reviewCount: 0,
  });
  const [sessionStartedAt, setSessionStartedAt] = useState(0);
  const [showAddWord, setShowAddWord] = useState(false);
  const [sessionComplete, setSessionComplete] = useState(false);
  const [newWord, setNewWord] = useState('');
  const [newMeaning, setNewMeaning] = useState('');
  const [newSentence, setNewSentence] = useState('');
  const [saving, setSaving] = useState(false);
  const responseStartedAt = useRef(0);
  const keystrokes = useRef<number[]>([]);
  const previousKeyAt = useRef<number | null>(null);
  const responseInput = useRef<HTMLInputElement>(null);
  const sessionId = useRef('');
  const reviewSequence = useRef(0);
  const progressRef = useRef<SessionProgress>({
    correct: 0,
    incorrect: 0,
    slips: 0,
    newCount: 0,
    reviewCount: 0,
  });

  const current = sessionQueue[queueIndex];
  const currentWord = current?.word;
  const feedbackDiff =
    currentWord && pendingAnswer ? buildRedPencilDiff(currentWord.text, pendingAnswer.response) : null;
  const recognitionOptions = useMemo(() => {
    if (!currentWord) return [];
    const alternatives = library
      .filter(({ word }) => word.id !== currentWord.id)
      .map(({ word }) => word.text);
    return shuffle([currentWord.text, ...shuffle(alternatives).slice(0, 3)]);
  }, [currentWord, library]);

  const reloadLibrary = async () => {
    const [words, states] = await Promise.all([db.words.toArray(), db.wordState.toArray()]);
    const stateById = new Map(states.map((state) => [state.wordId, state]));
    const now = Date.now();
    const loaded = words.map((word) => ({
      word,
      state: stateById.get(word.id) ?? createWordState(word.id, now),
    }));
    setLibrary(loaded);
  };

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        await db.open();
        await reloadLibrary();
      } catch (loadError) {
        if (mounted) {
          setError(loadError instanceof Error ? loadError.message : 'Could not open the local word library.');
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void load();
    return () => {
      mounted = false;
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    };
  }, []);

  useEffect(() => {
    if (active && currentWord && mode === 'typing' && !revealed) {
      responseInput.current?.focus();
    }
  }, [active, currentWord, mode, revealed]);

  const beginResponse = () => {
    responseStartedAt.current = performance.now();
    keystrokes.current = [];
    previousKeyAt.current = null;
  };

  const beginSession = () => {
    const now = Date.now();
    const dueWords = library
      .filter(({ state }) => new Date(state.dueAt).getTime() <= now)
      .sort((left, right) => left.state.dueAt.localeCompare(right.state.dueAt));
    if (!dueWords.length) return;

    sessionId.current = crypto.randomUUID();
    reviewSequence.current = 0;
    setSessionComplete(false);
    progressRef.current = { correct: 0, incorrect: 0, slips: 0, newCount: 0, reviewCount: 0 };
    setSessionQueue(dueWords);
    setQueueIndex(0);
    setProgress(progressRef.current);
    setSessionStartedAt(now);
    setPendingAnswer(null);
    setResponse('');
    setRevealed(mode === 'typing');
    setActive(true);
    if (mode !== 'typing') beginResponse();
  };

  const persistSession = async () => {
    const endedAt = Date.now();
    const finalProgress = progressRef.current;
    const total = finalProgress.correct + finalProgress.incorrect;
    const record: SessionRecord = {
      id: sessionId.current,
      startedAt: new Date(sessionStartedAt).toISOString(),
      durationMs: Math.max(0, endedAt - sessionStartedAt),
      newCount: finalProgress.newCount,
      reviewCount: finalProgress.reviewCount,
      accuracy: total === 0 ? 0 : finalProgress.correct / total,
      createdAt: new Date(endedAt).toISOString(),
    };
    await db.sessions.put(record);
  };

  const finishSession = async () => {
    try {
      await persistSession();
      setActive(false);
      setSessionComplete(true);
      setPendingAnswer(null);
      setResponse('');
      await reloadLibrary();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save this session.');
    }
  };

  const advance = async () => {
    setPendingAnswer(null);
    setResponse('');
    setRevealed(mode === 'typing');
    if (queueIndex + 1 >= sessionQueue.length) {
      await finishSession();
      return;
    }
    setQueueIndex((index) => index + 1);
    if (mode !== 'typing') beginResponse();
  };

  const recordReview = async (outcome: ReviewOutcome, answer: PendingAnswer) => {
    if (!current) return;
    const now = Date.now();
    const { word, state } = current;
    const result = Scheduler.next(state.status, outcome, now);
    const review: ReviewRecord = {
      id: `${sessionId.current}-${reviewSequence.current++}`,
      wordId: word.id,
      at: new Date(now).toISOString(),
      mode,
      prompt: getPromptText(word, mode),
      response: answer.response,
      correct: outcome === 'correct',
      latencyMs: answer.latencyMs,
      keystrokes: answer.keystrokes,
      hintUsed: false,
      slipFlag: outcome === 'slip',
      errorTypes: outcome === 'correct' ? [] : classifyError(word.text, answer.response),
      technique: mode,
    };
    const updatedState: WordStateRecord = {
      ...state,
      status: result.state,
      intervalStep: result.nextStep,
      dueAt: new Date(result.dueAt).toISOString(),
      lapses: state.lapses + (outcome === 'incorrect' ? 1 : 0),
      technique: mode,
      lastCorrectAt: outcome === 'correct' ? new Date(now).toISOString() : state.lastCorrectAt,
      updatedAt: new Date(now).toISOString(),
    };

    try {
      await db.transaction('rw', db.reviews, db.wordState, async () => {
        await db.reviews.put(review);
        await db.wordState.put(updatedState);
      });
      setError('');
      const nextProgress = {
        correct: progressRef.current.correct + (outcome === 'correct' ? 1 : 0),
        incorrect: progressRef.current.incorrect + (outcome === 'incorrect' ? 1 : 0),
        slips: progressRef.current.slips + (outcome === 'slip' ? 1 : 0),
        newCount: progressRef.current.newCount + (state.status === 'NEW' ? 1 : 0),
        reviewCount: progressRef.current.reviewCount + (state.status === 'NEW' ? 0 : 1),
      };
      progressRef.current = nextProgress;
      setProgress(nextProgress);
      await advance();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save this review.');
    }
  };

  const captureKeystroke = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key.length !== 1) return;
    const now = performance.now();
    if (responseStartedAt.current === 0) responseStartedAt.current = now;
    if (previousKeyAt.current !== null) {
      keystrokes.current.push(Math.round(now - previousKeyAt.current));
    }
    previousKeyAt.current = now;
  };

  const makeAnswer = (value: string): PendingAnswer => ({
    response: value,
    latencyMs: Math.max(0, Math.round(performance.now() - responseStartedAt.current)),
    keystrokes: [...keystrokes.current],
  });

  const submitResponse = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!currentWord || !response.trim()) return;
    const answer = makeAnswer(response);
    if (normalizeAnswer(response) === normalizeAnswer(currentWord.text)) {
      await recordReview('correct', answer);
    } else {
      setPendingAnswer(answer);
    }
  };

  const selectRecognition = async (selected: string) => {
    if (!currentWord) return;
    const answer = makeAnswer(selected);
    if (normalizeAnswer(selected) === normalizeAnswer(currentWord.text)) {
      await recordReview('correct', answer);
    } else {
      setResponse(selected);
      setPendingAnswer(answer);
    }
  };

  const addWord = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = newWord.trim();
    if (!text) return;
    setSaving(true);
    setError('');
    const now = new Date().toISOString();
    const word: WordRecord = {
      id: text.toLocaleLowerCase(),
      text,
      pack: 'personal',
      meaning: newMeaning.trim(),
      exampleSentence: newSentence.trim(),
      createdAt: now,
      updatedAt: now,
    };
    try {
      await db.transaction('rw', db.words, db.wordState, async () => {
        if (await db.words.get(word.id)) {
          throw new Error('That word is already in your desk.');
        }
        await db.words.put(word);
        await db.wordState.put(createWordState(word.id, Date.now()));
      });
      await reloadLibrary();
      setNewWord('');
      setNewMeaning('');
      setNewSentence('');
      setShowAddWord(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not add this word.');
    } finally {
      setSaving(false);
    }
  };

  const playWord = () => {
    if (
      !currentWord ||
      !('speechSynthesis' in window) ||
      typeof SpeechSynthesisUtterance === 'undefined'
    ) {
      setError('Speech playback is not available in this browser.');
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(currentWord.text);
    utterance.onend = beginResponse;
    utterance.onerror = () => setError('The browser could not play this word.');
    window.speechSynthesis.speak(utterance);
  };

  const eligibleModes = MODES.filter(({ value }) => {
    if (value === 'recognition') return library.length > 1;
    if (value === 'cloze') {
      return library.some(({ word }) => word.exampleSentence.toLocaleLowerCase().includes(word.text.toLocaleLowerCase()));
    }
    return true;
  });
  const dueCount = library.filter(({ state }) => new Date(state.dueAt).getTime() <= Date.now()).length;

  const showPrompt = () => {
    if (!currentWord) return null;
    switch (mode) {
      case 'typing':
        return (
          <div className="study-word">
            {revealed ? <strong>{currentWord.text}</strong> : <span className="covered-word">Word covered</span>}
            <button
              type="button"
              onClick={() => {
                if (revealed) beginResponse();
                setRevealed((value) => !value);
              }}
            >
              {revealed ? 'Hide word' : 'Show word'}
            </button>
          </div>
        );
      case 'dictation':
        return (
          <div className="prompt-block">
            <p>Listen, then spell the word.</p>
            <button type="button" onClick={playWord}>Play word</button>
          </div>
        );
      case 'meaning':
        return <p className="prompt-block">{currentWord.meaning || 'Spell the word from memory.'}</p>;
      case 'cloze':
        return (
          <p className="prompt-block">
            {currentWord.exampleSentence.toLocaleLowerCase().includes(currentWord.text.toLocaleLowerCase())
              ? sentenceWithBlank(currentWord.exampleSentence, currentWord.text)
              : currentWord.meaning || 'Spell the word from memory.'}
          </p>
        );
      case 'pattern':
        return (
          <div className="prompt-block">
            <p>Recall the spelling pattern.</p>
            {currentWord.patternTags?.length ? <p className="pattern-tags">{currentWord.patternTags.join(' · ')}</p> : null}
            {currentWord.chunks?.length ? <p className="word-chunks">{currentWord.chunks.join(' · ')}</p> : null}
          </div>
        );
      case 'recognition':
        return (
          <div className="prompt-block">
            <p>Choose the spelling you remember.</p>
            <div className="recognition-options">
              {recognitionOptions.map((option) => (
                <button type="button" key={option} onClick={() => void selectRecognition(option)}>{option}</button>
              ))}
            </div>
          </div>
        );
    }
  };

  if (loading) {
    return <main className="app-shell"><p role="status">Opening your local word desk…</p></main>;
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Spelling practice</p>
          <h1>Proofreader</h1>
        </div>
        <p className="desk-note">A quiet desk for words worth remembering.</p>
      </header>

      {error ? <p className="error-message" role="alert">{error}</p> : null}

      {sessionComplete ? (
        <section className="session-panel" aria-label="Session summary">
          <div className="session-card">
            <p className="eyebrow">Session complete</p>
            <h2>That’s the last word for now.</h2>
            <p>
              {progress.correct} recalled · {progress.incorrect} missed · {progress.slips}{' '}
              {progress.slips === 1 ? 'slip' : 'slips'}
            </p>
            <button type="button" className="primary-action" onClick={() => setSessionComplete(false)}>Return to desk</button>
          </div>
        </section>
      ) : !active ? (
        <section className="session-panel" aria-label="Session workspace">
          <div className="session-card">
            <p className="eyebrow">{library.length} {library.length === 1 ? 'word' : 'words'} in your desk</p>
            <h2>{library.length ? 'Ready for a proof session?' : 'Start with one word'}</h2>
            <p>Recall each spelling, check the pattern, and let the next review find its place.</p>
            {library.length > 0 ? (
              <>
                <label className="mode-picker">
                  Practice mode
                  <select value={mode} onChange={(event) => setMode(event.target.value as ReviewMode)}>
                    {eligibleModes.map(({ value, label }) => <option value={value} key={value}>{label}</option>)}
                  </select>
                </label>
                <button type="button" className="primary-action" onClick={beginSession} disabled={dueCount === 0}>
                  {dueCount ? `Start session · ${dueCount} due` : 'Nothing due right now'}
                </button>
              </>
            ) : null}
            <button type="button" className="text-action" onClick={() => setShowAddWord((value) => !value)}>
              {showAddWord ? 'Cancel' : library.length ? 'Add a word' : 'Add your first word'}
            </button>
            {showAddWord ? (
              <form className="add-word-form" onSubmit={(event) => void addWord(event)}>
                <label>
                  Word
                  <input value={newWord} onChange={(event) => setNewWord(event.target.value)} required autoComplete="off" />
                </label>
                <label>
                  Meaning <span className="optional-label">optional</span>
                  <input value={newMeaning} onChange={(event) => setNewMeaning(event.target.value)} />
                </label>
                <label>
                  Example sentence <span className="optional-label">optional</span>
                  <input value={newSentence} onChange={(event) => setNewSentence(event.target.value)} />
                </label>
                <button className="primary-action" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save word'}</button>
              </form>
            ) : null}
          </div>
        </section>
      ) : currentWord ? (
        <section className="session-panel" aria-label="Practice session">
          <div className="session-progress">
            <div className="progress-line"><span style={{ width: `${(queueIndex / sessionQueue.length) * 100}%` }} /></div>
            <span>{queueIndex + 1} of {sessionQueue.length}</span>
            <button type="button" className="text-action" onClick={() => void finishSession()}>End session</button>
          </div>
          <article className="session-card practice-card">
            <p className="eyebrow">{MODES.find((item) => item.value === mode)?.label}</p>
            <h2>Recall the spelling</h2>
            {showPrompt()}

            {pendingAnswer ? (
              <div className="answer-review" aria-live="polite">
                <p className="eyebrow">Check the word</p>
                <p className="correct-spelling">{currentWord.text}</p>
                <img
                  className="red-pencil-diff"
                  src={`data:image/svg+xml,${encodeURIComponent(feedbackDiff?.svg ?? '')}`}
                  alt={`Spelling comparison for ${pendingAnswer.response}`}
                />
                <p className="detected-patterns" aria-label="Detected spelling patterns">
                  {feedbackDiff?.issues.map((issue) => issue.replace(/_/g, ' ')).join(' · ')}
                </p>
                <div className="outcome-actions">
                  <button type="button" onClick={() => void recordReview('slip', pendingAnswer)}>I knew it — a slip</button>
                  <button type="button" className="primary-action" onClick={() => void recordReview('incorrect', pendingAnswer)}>I didn’t know</button>
                </div>
              </div>
            ) : mode !== 'recognition' ? (
              <form className="answer-form" onSubmit={(event) => void submitResponse(event)}>
                <label htmlFor="spelling-answer">Your spelling</label>
                <input
                  ref={responseInput}
                  id="spelling-answer"
                  value={response}
                  onChange={(event) => setResponse(event.target.value)}
                  onKeyDown={captureKeystroke}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  disabled={mode === 'typing' && revealed}
                />
                <button type="submit" className="primary-action" disabled={!response.trim() || (mode === 'typing' && revealed)}>
                  Check spelling
                </button>
              </form>
            ) : null}
          </article>
        </section>
      ) : null}
    </main>
  );
}
