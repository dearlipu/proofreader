import Dexie, { type Table } from 'dexie';
import type { ReviewMode, WordState } from '../core/scheduler';

export type SettingValue = string | number | boolean | Record<string, unknown> | null;

export interface WordRecord {
  id: string;
  text: string;
  pack: string;
  meaning: string;
  exampleSentence: string;
  chunks?: string[];
  hardLetterRanges?: [number, number][];
  patternTags?: string[];
  knownLevel?: number;
  createdAt: string;
  updatedAt: string;
}

export interface WordStateRecord {
  wordId: string;
  status: WordState;
  intervalStep: number;
  dueAt: string;
  lapses: number;
  difficulty: number;
  stability: number;
  technique: string;
  lastCorrectAt: string | null;
  updatedAt: string;
}

export interface ReviewRecord {
  id: string;
  wordId: string;
  at: string;
  mode: ReviewMode;
  prompt: string;
  response: string;
  correct: boolean;
  latencyMs: number;
  keystrokes: number[];
  hintUsed: boolean;
  slipFlag: boolean;
  errorTypes: string[];
  technique: string;
}

export interface SessionRecord {
  id: string;
  startedAt: string;
  durationMs: number;
  newCount: number;
  reviewCount: number;
  accuracy: number;
  createdAt: string;
}

export interface SettingRecord {
  key: string;
  value: SettingValue;
  updatedAt: string;
}

class ProofreaderDatabase extends Dexie {
  words!: Table<WordRecord, string>;
  wordState!: Table<WordStateRecord, string>;
  reviews!: Table<ReviewRecord, string>;
  sessions!: Table<SessionRecord, string>;
  settings!: Table<SettingRecord, string>;

  constructor() {
    super('proofreader-db');

    this.version(1).stores({
      words: '&id, pack, knownLevel, updatedAt',
      wordState: '&wordId, status, dueAt, lastCorrectAt, technique',
      reviews: '&id, wordId, at, mode, correct, technique',
      sessions: '&id, startedAt, accuracy',
      settings: '&key, updatedAt'
    });
  }
}

export const db = new ProofreaderDatabase();

export async function openDatabase(): Promise<void> {
  await db.open();
}

export async function resetDatabase(): Promise<void> {
  db.close();
  if (typeof indexedDB !== 'undefined') {
    await db.delete();
  }
}
