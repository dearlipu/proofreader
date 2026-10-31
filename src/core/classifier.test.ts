import { describe, expect, it } from 'vitest';
import { classifyError } from './classifier';

describe('classifyError', () => {
  it('detects a missing letter', () => {
    expect(classifyError('receive', 'recive')).toContain('missing_letter');
  });

  it('detects an extra letter', () => {
    expect(classifyError('receipt', 'receiptt')).toContain('extra_letter');
  });

  it('detects a transposition', () => {
    expect(classifyError('necessary', 'necesasry')).toContain('transposition');
  });

  it('detects a vowel swap', () => {
    expect(classifyError('receive', 'receeve')).toContain('vowel_swap');
  });

  it('detects a double consonant error', () => {
    expect(classifyError('receipt', 'reciept')).toContain('double_consonant_error');
  });

  it('detects a suffix error', () => {
    expect(classifyError('definitely', 'definitly')).toContain('suffix_error');
  });

  it('detects a prefix error', () => {
    expect(classifyError('receive', 'recieve')).toContain('prefix_error');
  });

  it('detects a similar word confusion', () => {
    expect(classifyError('receive', 'receipt')).toContain('similar_word_confusion');
  });

  it('detects a phonetic substitution', () => {
    expect(classifyError('deadline', 'dealdine')).toContain('phonetic_substitution');
  });

  it('returns other for unrelated errors', () => {
    expect(classifyError('invoice', 'invoce')).toEqual(['other']);
  });
});
