import {
  IconBook2,
  IconFileExport,
  IconFileImport,
  IconLayoutGrid,
  IconMenu2,
  IconMoon,
  IconPalette,
  IconPlus,
  IconSparkles,
  IconSun,
  IconWriting,
} from '@tabler/icons-react';
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react';
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

type ViewName = 'today' | 'drawers' | 'patterns' | 'desk';

type ThemeName = 'paper' | 'slate';

type ReadingComfort = {
  fontScale: number;
  lineHeight: number;
  highContrast: boolean;
  reducedMotion: boolean;
};

type TechniqueKey =
  | 'say-it-aloud'
  | 'chunk-it'
  | 'pattern-first'
  | 'compare-and-correct'
  | 'sound-it-out';

const TECHNIQUES: Array<{ key: TechniqueKey; label: string; hint: string }> = [
  { key: 'say-it-aloud', label: 'Say it aloud', hint: 'Hear the word before you type it.' },
  { key: 'chunk-it', label: 'Chunk it', hint: 'Break the word into parts you can hold in memory.' },
  { key: 'pattern-first', label: 'Pattern first', hint: 'Look for the rule before the full spelling.' },
  { key: 'compare-and-correct', label: 'Compare and correct', hint: 'Write once, check once, then fix the miss.' },
  { key: 'sound-it-out', label: 'Sound it out', hint: 'Map the sound to the letters before answering.' },
];

const MODES: Array<{ value: ReviewMode; label: string }> = [
  { value: 'typing', label: 'Study, hide, spell' },
  { value: 'dictation', label: 'Dictation' },
  { value: 'meaning', label: 'Meaning' },
  { value: 'cloze', label: 'Sentence blank' },
  { value: 'recognition', label: 'Choose the spelling' },
  { value: 'pattern', label: 'Spelling pattern' },
];

const DEFAULT_PATTERN_HINTS = ['silent letter', 'double consonant', 'prefix', 'suffix', 'vowel swap'];
const DEFAULT_READING_COMFORT: ReadingComfort = {
  fontScale: 1,
  lineHeight: 1.5,
  highContrast: false,
  reducedMotion: false,
};
const TECHNIQUE_HINTS = [
  'Say the word aloud once before you type it.',
  'Chunk it into sounds or prefixes before checking.',
  'Look for the pattern instead of the whole word.',
  'Write it once and compare your result to the target.',
];

const SEED_PACKS: Array<{
  id: string;
  label: string;
  description: string;
  words: Array<{ text: string; meaning: string; exampleSentence: string }>;
}> = [
  {
    id: 'everyday-words',
    label: 'Everyday words',
    description: 'Useful high-frequency words for daily review.',
    words: [
      { text: 'because', meaning: 'For the reason that.', exampleSentence: 'I stayed home because I felt unwell.' },
      { text: 'friend', meaning: 'A person you know well and trust.', exampleSentence: 'My friend sent the note before lunch.' },
      { text: 'receipt', meaning: 'A written proof of a purchase.', exampleSentence: 'Keep the receipt until the refund is complete.' },
      { text: 'beautiful', meaning: 'Pleasing to look at or admire.', exampleSentence: 'The garden looked beautiful in the morning light.' },
    ],
  },
  {
    id: 'proofreader-core',
    label: 'Proofreading core',
    description: 'Words that commonly trip up careful spellers.',
    words: [
      { text: 'necessary', meaning: 'Required or essential.', exampleSentence: 'It was necessary to check the final draft.' },
      { text: 'separate', meaning: 'Set apart from something else.', exampleSentence: 'Please separate the papers by date.' },
      { text: 'business', meaning: 'Commercial activity or work.', exampleSentence: 'The business opened early today.' },
      { text: 'beginning', meaning: 'The start of something.', exampleSentence: 'The beginning of the lesson was easy to follow.' },
    ],
  },
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

function getDayKey(date: Date): string {
  const local = new Date(date.getTime() - (date.getTimezoneOffset() * 60000));
  return local.toISOString().slice(0, 10);
}

function formatTodayLabel(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = new Intl.DateTimeFormat('en-US', { month: 'long' }).format(date).toLocaleUpperCase();
  const year = String(date.getFullYear()).slice(-2);
  return `${day} ${month} ${year}`;
}

function toTechniqueKey(value: string | null | undefined): TechniqueKey {
  return TECHNIQUES.some((technique) => technique.key === value)
    ? (value as TechniqueKey)
    : 'say-it-aloud';
}

function summarizeTechniques(reviews: ReviewRecord[]): Array<{ key: TechniqueKey; label: string; score: number; count: number }> {
  const scores = new Map<TechniqueKey, { score: number; count: number }>();

  reviews.forEach((review) => {
    const key = toTechniqueKey(review.technique);
    const current = scores.get(key) ?? { score: 0, count: 0 };
    current.score += review.correct ? 1 : -1;
    current.count += 1;
    scores.set(key, current);
  });

  return TECHNIQUES.map((technique) => ({
    key: technique.key,
    label: technique.label,
    score: scores.get(technique.key)?.score ?? 0,
    count: scores.get(technique.key)?.count ?? 0,
  })).sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return right.count - left.count;
  });
}

function resolveTechniqueForWord(
  wordId: string,
  reviews: ReviewRecord[],
  fallback: TechniqueKey,
): TechniqueKey {
  const relevant = reviews.filter((review) => review.wordId === wordId);
  if (!relevant.length) {
    return fallback;
  }

  const techniqueScores = summarizeTechniques(relevant);
  const best = techniqueScores[0];
  return best ? best.key : fallback;
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
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [sessionComplete, setSessionComplete] = useState(false);
  const [view, setView] = useState<ViewName>('today');
  const [navigationMenuOpen, setNavigationMenuOpen] = useState(false);
  const [theme, setTheme] = useState<ThemeName>('slate');
  const [readingComfort, setReadingComfort] = useState<ReadingComfort>(DEFAULT_READING_COMFORT);
  const [recentReviews, setRecentReviews] = useState<ReviewRecord[]>([]);
  const [newWord, setNewWord] = useState('');
  const [newMeaning, setNewMeaning] = useState('');
  const [newSentence, setNewSentence] = useState('');
  const [saving, setSaving] = useState(false);
  const [activeTechnique, setActiveTechnique] = useState<TechniqueKey>('say-it-aloud');
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const navigationMenuRef = useRef<HTMLDivElement | null>(null);
  const responseStartedAt = useRef(0);
  const keystrokes = useRef<number[]>([]);
  const previousKeyAt = useRef<number | null>(null);
  const responseInput = useRef<HTMLInputElement>(null);
  const readingSettingsLoaded = useRef(false);
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

  const drawerCounts = useMemo(() => {
    const counts: Record<WordState, number> = { NEW: 0, WEAK: 0, ACTIVE: 0, MASTERED: 0 };
    library.forEach(({ state }) => {
      counts[state.status] += 1;
    });
    return counts;
  }, [library]);

  const patternCounts = useMemo(() => {
    const counts = new Map<string, number>();
    recentReviews.forEach((review) => {
      review.errorTypes.forEach((type) => {
        counts.set(type, (counts.get(type) ?? 0) + 1);
      });
    });
    return [...counts.entries()].sort((left, right) => right[1] - left[1]);
  }, [recentReviews]);

  const keyboardHeatmap = useMemo(() => {
    const counts = new Map<string, number>();
    recentReviews.forEach((review) => {
      const answer = review.response.toLowerCase();
      const target = review.prompt.toLowerCase();
      for (let index = 0; index < Math.max(answer.length, target.length); index += 1) {
        if (answer[index] && answer[index] !== target[index]) {
          counts.set(answer[index], (counts.get(answer[index]) ?? 0) + 1);
        }
      }
    });

    return Array.from('qwertyuiopasdfghjklzxcvbnm').map((key) => ({
      key,
      count: counts.get(key) ?? 0,
    }));
  }, [recentReviews]);

  const retentionCurve = useMemo(() => {
    const daily = new Map<string, number>();
    recentReviews.forEach((review) => {
      const day = new Date(review.at).toISOString().slice(0, 10);
      if (review.correct) {
        daily.set(day, (daily.get(day) ?? 0) + 1);
      }
    });

    const labels = Array.from({ length: 7 }, (_, index) => {
      const date = new Date();
      date.setDate(date.getDate() - (6 - index));
      return date.toISOString().slice(0, 10);
    });

    return labels.map((day) => daily.get(day) ?? 0);
  }, [recentReviews]);

  const patternHints = useMemo(() => {
    const counts = new Map<string, number>();
    library.forEach(({ word }) => {
      (word.patternTags ?? []).forEach((tag) => {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      });
    });

    const entries = [...counts.entries()].sort((left, right) => right[1] - left[1]);
    if (!entries.length) {
      return DEFAULT_PATTERN_HINTS;
    }

    return entries.slice(0, 4).map(([tag]) => tag.replace(/_/g, ' '));
  }, [library]);

  const techniqueSummary = useMemo(() => {
    const ranked = summarizeTechniques(recentReviews);
    const best = ranked[0];
    const topThree = ranked.slice(0, 3);
    return {
      best,
      topThree,
      recommendation: best ? best.label : 'Say it aloud',
      detail: best ? `${best.label} is the strongest match in your recent reviews.` : 'Say it aloud is the gentlest place to start.',
    };
  }, [recentReviews]);

  const dueCount = library.filter(({ state }) => new Date(state.dueAt).getTime() <= Date.now()).length;
  const progressSummary = useMemo(() => {
    const lastWeek = recentReviews.filter((review) => {
      const ageMs = Date.now() - new Date(review.at).getTime();
      return ageMs >= 0 && ageMs <= 1000 * 60 * 60 * 24 * 7;
    });
    const attempts = lastWeek.length;
    const correctAttempts = lastWeek.filter((review) => review.correct).length;
    const accuracy = attempts > 0 ? Math.round((correctAttempts / attempts) * 100) : 0;
    const todayReviewed = recentReviews.filter(
      (review) => getDayKey(new Date(review.at)) === getDayKey(new Date()),
    ).length;
    const todayTotal = todayReviewed + dueCount;
    const todayProgress = todayTotal > 0 ? Math.round((todayReviewed / todayTotal) * 100) : 0;

    const reviewDays = new Set(
      lastWeek.filter((review) => review.correct).map((review) => getDayKey(new Date(review.at))),
    );

    let streak = 0;
    const cursor = new Date();
    while (reviewDays.has(getDayKey(cursor))) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }

    return {
      dueCount,
      accuracy,
      todayReviewed,
      todayProgress,
      streak,
      bestTechnique: techniqueSummary.recommendation,
    };
  }, [dueCount, recentReviews, techniqueSummary.recommendation]);

  const reloadLibrary = async () => {
    const [words, states, reviews] = await Promise.all([
      db.words.toArray(),
      db.wordState.toArray(),
      db.reviews.orderBy('at').reverse().limit(100).toArray(),
    ]);
    const stateById = new Map(states.map((state) => [state.wordId, state]));
    const now = Date.now();
    const loaded = words.map((word) => ({
      word,
      state: stateById.get(word.id) ?? createWordState(word.id, now),
    }));
    setLibrary(loaded);
    setRecentReviews(reviews);
  };

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (!navigationMenuOpen) return;

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (event.target instanceof Node && !navigationMenuRef.current?.contains(event.target)) {
        setNavigationMenuOpen(false);
      }
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setNavigationMenuOpen(false);
    };

    window.addEventListener('pointerdown', closeOnOutsideClick);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('pointerdown', closeOnOutsideClick);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [navigationMenuOpen]);

  useEffect(() => {
    document.documentElement.style.setProperty('--font-scale', String(readingComfort.fontScale));
    document.documentElement.style.setProperty('--line-height', String(readingComfort.lineHeight));
    document.documentElement.dataset.highContrast = String(readingComfort.highContrast);
    document.documentElement.dataset.reducedMotion = String(readingComfort.reducedMotion);
  }, [readingComfort]);

  useEffect(() => {
    const loadSettings = async () => {
      const stored = await db.settings.get('readingComfort');
      if (stored && typeof stored.value === 'object' && stored.value !== null) {
        const value = stored.value as Partial<ReadingComfort>;
        const comfort = {
          fontScale: value.fontScale ?? DEFAULT_READING_COMFORT.fontScale,
          lineHeight: value.lineHeight ?? DEFAULT_READING_COMFORT.lineHeight,
          highContrast: value.highContrast ?? DEFAULT_READING_COMFORT.highContrast,
          reducedMotion: value.reducedMotion ?? DEFAULT_READING_COMFORT.reducedMotion,
        };
        setReadingComfort(comfort);
      }
      readingSettingsLoaded.current = true;
    };

    void loadSettings();
  }, []);

  useEffect(() => {
    if (!readingSettingsLoaded.current) return;
    void db.settings.put({
      key: 'readingComfort',
      value: readingComfort,
      updatedAt: new Date().toISOString(),
    });
  }, [readingComfort]);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        await db.open();
        const onboardingState = await db.settings.get('onboardingComplete');
        if (mounted) {
          setShowOnboarding(onboardingState?.value !== true);
        }
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

  useEffect(() => {
    if (!currentWord) return;
    const fallbackTechnique = toTechniqueKey(current?.state?.technique ?? 'say-it-aloud');
    setActiveTechnique(resolveTechniqueForWord(currentWord.id, recentReviews, fallbackTechnique));
  }, [currentWord, recentReviews]);

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

    const firstTechnique = resolveTechniqueForWord(dueWords[0].word.id, recentReviews, toTechniqueKey(dueWords[0].state.technique));
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
    setActiveTechnique(firstTechnique);
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

  const closeOnboarding = async () => {
    try {
      await db.settings.put({
        key: 'onboardingComplete',
        value: true,
        updatedAt: new Date().toISOString(),
      });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save onboarding state.');
    } finally {
      setShowOnboarding(false);
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
      technique: activeTechnique,
    };
    const updatedState: WordStateRecord = {
      ...state,
      status: result.state,
      intervalStep: result.nextStep,
      dueAt: new Date(result.dueAt).toISOString(),
      lapses: state.lapses + (outcome === 'incorrect' ? 1 : 0),
      technique: activeTechnique,
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

  const addSeedPack = async (packId: string) => {
    const pack = SEED_PACKS.find((candidate) => candidate.id === packId);
    if (!pack) return;

    try {
      await db.transaction('rw', db.words, db.wordState, async () => {
        for (const entry of pack.words) {
          const wordId = entry.text.toLocaleLowerCase();
          const existing = await db.words.get(wordId);
          if (existing) continue;

          const now = new Date().toISOString();
          await db.words.put({
            id: wordId,
            text: entry.text,
            pack: pack.id,
            meaning: entry.meaning,
            exampleSentence: entry.exampleSentence,
            createdAt: now,
            updatedAt: now,
          });
          await db.wordState.put(createWordState(wordId, Date.now()));
        }
      });
      await reloadLibrary();
      setError('');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not add the selected seed pack.');
    }
  };

  const exportDesk = async () => {
    const words = await db.words.toArray();
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), words }, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'proofreader-desk.json';
    link.click();
    URL.revokeObjectURL(url);
  };

  const importDesk = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const payload = JSON.parse(text) as { words?: WordRecord[] } | WordRecord[];
      const importWords = Array.isArray(payload) ? payload : payload.words ?? [];

      await db.transaction('rw', db.words, db.wordState, async () => {
        for (const entry of importWords) {
          if (!entry?.text || !entry?.id) continue;
          const wordId = entry.id.toLocaleLowerCase();
          const existing = await db.words.get(wordId);
          if (existing) continue;
          await db.words.put({
            ...entry,
            id: wordId,
            text: entry.text,
            pack: entry.pack || 'imported',
            meaning: entry.meaning || '',
            exampleSentence: entry.exampleSentence || '',
            updatedAt: new Date().toISOString(),
          });
          await db.wordState.put(createWordState(wordId, Date.now()));
        }
      });
      await reloadLibrary();
      setError('');
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : 'That file could not be imported.');
    } finally {
      event.target.value = '';
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
  const techniqueSwitchRequired = currentWord
    ? Scheduler.techniqueChangeRequired(
        recentReviews.filter((review) => review.wordId === currentWord.id && !review.correct).length,
      )
    : false;

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

  const navItems: Array<{ key: ViewName; label: string; icon: typeof IconLayoutGrid }> = [
    { key: 'today', label: 'Today', icon: IconLayoutGrid },
    { key: 'drawers', label: 'Drawers', icon: IconBook2 },
    { key: 'patterns', label: 'Patterns', icon: IconSparkles },
    { key: 'desk', label: 'Desk', icon: IconWriting },
  ];

  const renderTodayView = () => (
    <>
      {showOnboarding ? (
        <section className="onboarding-modal" aria-label="Onboarding">
          <div className="onboarding-card">
            <p className="eyebrow">Welcome</p>
            <h2>Your desk is ready.</h2>
            <p>
              Proofreader teaches spelling from memory: you see the prompt, recall the word, check the pattern,
              and let the scheduler decide when it should return.
            </p>
            <ul>
              <li>Use the due list to practice the words that are ready.</li>
              <li>Mark a miss as a slip when you nearly had it.</li>
              <li>Check the pattern drawer to revisit the rules you miss most.</li>
            </ul>
            <div className="onboarding-actions">
              <button type="button" className="primary-action" onClick={() => void closeOnboarding()}>
                Start proving words
              </button>
              <button type="button" className="text-action" onClick={() => void closeOnboarding()}>
                Skip intro
              </button>
            </div>
          </div>
        </section>
      ) : null}

      <section className="workspace-overview" aria-label="Desk overview">
        <article className="drawer-card progress-card overview-card">
          <div className="overview-card-heading">
            <p className="eyebrow">Progress</p>
          </div>
          <div className="progress-grid">
            <div className="progress-stat">
              <span>Due</span>
              <strong>{progressSummary.dueCount}</strong>
            </div>
            <div className="progress-stat">
              <span>Weekly accuracy</span>
              <strong>{progressSummary.accuracy}%</strong>
            </div>
            <div className="progress-stat">
              <span>Streak</span>
              <strong>{progressSummary.streak} days</strong>
            </div>
            <div className="progress-stat">
              <span>Best ritual</span>
              <strong>{progressSummary.bestTechnique}</strong>
            </div>
          </div>
        </article>

        <article className="drawer-card overview-card today-overview-card">
          <div className="overview-card-heading">
            <p className="eyebrow today-date">{formatTodayLabel(new Date())}</p>
          </div>
          <ul className="today-summary">
            <li><strong>{dueCount}</strong><span>ready</span></li>
            <li><strong>{drawerCounts.NEW}</strong><span>new</span></li>
            <li><strong>{drawerCounts.WEAK}</strong><span>weak</span></li>
          </ul>
          <div className="today-progress">
            <div className="today-progress-heading">
              <span>Today’s reviews</span>
              <strong>{progressSummary.todayReviewed} done · {dueCount} due</strong>
            </div>
            <div
              className="today-progress-track"
              role="progressbar"
              aria-label="Today’s review progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progressSummary.todayProgress}
            >
              <span style={{ width: `${progressSummary.todayProgress}%` }} />
            </div>
          </div>
        </article>
      </section>

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
          <div className="session-card session-start-card">
            <div className="session-intro">
              <p className="eyebrow">{library.length} {library.length === 1 ? 'word' : 'words'} in your desk</p>
              <h2>{library.length ? 'Ready for a proof session?' : 'Start with one word'}</h2>
              <p>Recall each spelling, check the pattern, and let the next review find its place.</p>
            </div>
            {library.length > 0 ? (
              <div className="session-actions">
                <label className="mode-picker">
                  Practice mode
                  <select value={mode} onChange={(event) => setMode(event.target.value as ReviewMode)}>
                    {eligibleModes.map(({ value, label }) => <option value={value} key={value}>{label}</option>)}
                  </select>
                </label>
                <button type="button" className="primary-action" onClick={beginSession} disabled={dueCount === 0}>
                  {dueCount ? `Start session · ${dueCount} due` : 'Nothing due right now'}
                </button>
                <button type="button" className="text-action" onClick={() => setShowAddWord((value) => !value)}>
                  {showAddWord ? 'Cancel' : 'Add a word'}
                </button>
              </div>
            ) : null}
            {!library.length ? (
              <div className="session-actions">
                <button type="button" className="primary-action" onClick={() => setShowAddWord((value) => !value)}>
                  {showAddWord ? 'Cancel' : 'Add your first word'}
                </button>
              </div>
            ) : null}
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
            <div className="technique-bar" aria-label="Technique rotation">
              <p className="eyebrow">Technique</p>
              <div className="technique-pills">
                {TECHNIQUES.map((technique) => (
                  <button
                    key={technique.key}
                    type="button"
                    className={activeTechnique === technique.key ? 'technique-pill active' : 'technique-pill'}
                    onClick={() => setActiveTechnique(technique.key)}
                  >
                    {technique.label}
                  </button>
                ))}
              </div>
              <p className="technique-hint">
                {techniqueSwitchRequired
                  ? 'Three misses in a row: rotate your technique before the next attempt.'
                  : TECHNIQUES.find((technique) => technique.key === activeTechnique)?.hint}
              </p>
            </div>
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
    </>
  );

  const renderDrawersView = () => (
    <section className="view-panel" aria-label="Drawers overview">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Study tools</p>
          <h2>Desk drawers</h2>
        </div>
      </div>
      <section className="drawer-grid" aria-label="Desk drawers">
        <article className="drawer-card progress-card">
          <p className="eyebrow">Progress</p>
          <h3>Desk momentum</h3>
          <div className="progress-grid">
            <div className="progress-stat">
              <span>Due</span>
              <strong>{progressSummary.dueCount}</strong>
            </div>
            <div className="progress-stat">
              <span>7-day accuracy</span>
              <strong>{progressSummary.accuracy}%</strong>
            </div>
            <div className="progress-stat">
              <span>Streak</span>
              <strong>{progressSummary.streak} days</strong>
            </div>
            <div className="progress-stat">
              <span>Best ritual</span>
              <strong>{progressSummary.bestTechnique}</strong>
            </div>
          </div>
        </article>
        <article className="drawer-card">
          <p className="eyebrow">Pattern drawer</p>
          <h3>Common habits to revisit</h3>
          <ul>{patternHints.map((hint) => <li key={hint}>{hint}</li>)}</ul>
        </article>
        <article className="drawer-card">
          <p className="eyebrow">Technique rotation</p>
          <h3>Ways to approach a miss</h3>
          <ul>{TECHNIQUE_HINTS.map((hint) => <li key={hint}>{hint}</li>)}</ul>
        </article>
        <article className="drawer-card">
          <p className="eyebrow">What works for you</p>
          <h3>{techniqueSummary.recommendation}</h3>
          <p className="technique-summary-text">{techniqueSummary.detail}</p>
          <ul>
            {techniqueSummary.topThree.map(({ key, label, score }) => (
              <li key={key}><strong>{label}</strong> · {score >= 0 ? `${score} wins` : `${Math.abs(score)} misses`}</li>
            ))}
          </ul>
        </article>
      </section>
    </section>
  );

  const renderPatternsView = () => (
    <section className="view-panel" aria-label="Patterns overview">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Patterns</p>
          <h2>Spelling signals</h2>
        </div>
      </div>
      <div className="pattern-grid">
        <article className="drawer-card pattern-card">
          <p className="eyebrow">Pattern counts</p>
          <h3>Most repeated misses</h3>
          <ul>
            {patternCounts.length ? patternCounts.map(([tag, count]) => (
              <li key={tag}><strong>{tag.replace(/_/g, ' ')}</strong> · {count}</li>
            )) : <li>No patterns logged yet.</li>}
          </ul>
        </article>

        <article className="drawer-card pattern-card">
          <p className="eyebrow">Keyboard heatmap</p>
          <h3>Letters that slip</h3>
          <div className="heatmap" aria-label="Keyboard heatmap">
            {keyboardHeatmap.map(({ key, count }) => (
              <span key={key} className={count > 0 ? 'heatmap-key active' : 'heatmap-key'} title={`${key}: ${count}`}>
                {key}
              </span>
            ))}
          </div>
        </article>

        <article className="drawer-card pattern-card wide-card">
          <p className="eyebrow">Retention curve</p>
          <h3>Recent accuracy</h3>
          <div className="retention-chart" aria-label="Retention curve">
            {retentionCurve.map((value, index) => (
              <div key={`${value}-${index}`} className="retention-bar-wrap">
                <span className="retention-bar" style={{ height: `${Math.max(12, value * 28)}%` }} />
                <small>{index + 1}</small>
              </div>
            ))}
          </div>
        </article>
      </div>
    </section>
  );

  const renderDeskView = () => (
    <section className="session-panel" aria-label="Desk settings">
      <div className="session-card">
        <p className="eyebrow">Desk</p>
        <h2>Reading comfort</h2>
        <p>Sound off by default, softly tick on correct, and keep quiet stats until after a word is checked.</p>
        <div className="desk-controls" aria-label="Reading comfort controls">
          <div className="comfort-group">
            <span>Text size</span>
            <div className="segmented-control" role="group" aria-label="Text size">
              <button type="button" className={readingComfort.fontScale <= 0.95 ? 'active' : ''} onClick={() => setReadingComfort((current) => ({ ...current, fontScale: 0.95 }))}>A-</button>
              <button type="button" className={readingComfort.fontScale === 1 ? 'active' : ''} onClick={() => setReadingComfort((current) => ({ ...current, fontScale: 1 }))}>A</button>
              <button type="button" className={readingComfort.fontScale >= 1.15 ? 'active' : ''} onClick={() => setReadingComfort((current) => ({ ...current, fontScale: 1.15 }))}>A+</button>
            </div>
          </div>
          <div className="comfort-group">
            <span>Line spacing</span>
            <div className="segmented-control" role="group" aria-label="Line spacing">
              <button type="button" className={readingComfort.lineHeight <= 1.4 ? 'active' : ''} onClick={() => setReadingComfort((current) => ({ ...current, lineHeight: 1.35 }))}>Compact</button>
              <button type="button" className={readingComfort.lineHeight >= 1.6 ? 'active' : ''} onClick={() => setReadingComfort((current) => ({ ...current, lineHeight: 1.7 }))}>Comfort</button>
            </div>
          </div>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={readingComfort.highContrast}
              onChange={(event) =>
                setReadingComfort((current) => ({ ...current, highContrast: event.target.checked }))
              }
            />
            High contrast
          </label>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={readingComfort.reducedMotion}
              onChange={(event) =>
                setReadingComfort((current) => ({ ...current, reducedMotion: event.target.checked }))
              }
            />
            Reduced motion
          </label>
        </div>
        <div className="seed-pack-panel">
          <p className="eyebrow">Seed packs</p>
          <div className="pack-list">
            {SEED_PACKS.map((pack) => (
              <div key={pack.id} className="pack-card">
                <div>
                  <h3>{pack.label}</h3>
                  <p>{pack.description}</p>
                </div>
                <button type="button" onClick={() => void addSeedPack(pack.id)}>
                  Add {pack.label.toLowerCase()} pack
                </button>
              </div>
            ))}
          </div>
        </div>
        <div className="desk-controls">
          <button type="button" onClick={() => void exportDesk()}>
            <IconFileExport size={15} stroke={1.8} />
            <span>Export desk</span>
          </button>
          <button type="button" onClick={() => importInputRef.current?.click()}>
            <IconFileImport size={15} stroke={1.8} />
            <span>Import desk</span>
          </button>
          <button type="button" onClick={() => setTheme((currentTheme) => (currentTheme === 'paper' ? 'slate' : 'paper'))}>
            {theme === 'paper' ? <IconMoon size={15} stroke={1.8} /> : <IconSun size={15} stroke={1.8} />}
            <span>Switch to {theme === 'paper' ? 'slate' : 'paper'} theme</span>
          </button>
          <button type="button" onClick={() => setShowAddWord((value) => !value)}>
            <IconPlus size={15} stroke={1.8} />
            <span>{showAddWord ? 'Hide word editor' : 'Add a word'}</span>
          </button>
        </div>
        <input ref={importInputRef} type="file" accept="application/json" hidden onChange={(event) => void importDesk(event)} />
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
  );

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <IconWriting className="brand-mark" size={25} stroke={1.8} aria-hidden="true" />
          <h1>Proofreader</h1>
        </div>
        <p className="desk-note">A quiet desk for words worth remembering.</p>
        <div className="topbar-menu" ref={navigationMenuRef}>
          <button
            type="button"
            className="menu-toggle"
            aria-label={navigationMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={navigationMenuOpen}
            aria-controls="primary-navigation"
            onClick={() => setNavigationMenuOpen((open) => !open)}
          >
            <IconMenu2 size={20} stroke={1.8} />
          </button>
          {navigationMenuOpen ? (
            <nav id="primary-navigation" className="topbar-nav" aria-label="Main navigation">
              {navItems.map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  type="button"
                  className={key === view ? 'nav-button active' : 'nav-button'}
                  aria-current={key === view ? 'page' : undefined}
                  onClick={() => {
                    setView(key);
                    setNavigationMenuOpen(false);
                  }}
                >
                  <Icon size={15} stroke={1.8} />
                  <span>{label}</span>
                </button>
              ))}
            </nav>
          ) : null}
        </div>
      </header>

      {error ? <p className="error-message" role="alert">{error}</p> : null}

      {view === 'today' && renderTodayView()}
      {view === 'drawers' && renderDrawersView()}
      {view === 'patterns' && renderPatternsView()}
      {view === 'desk' && renderDeskView()}
    </main>
  );
}
