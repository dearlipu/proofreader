import { describe, expect, it } from 'vitest';
import { buildRedPencilDiff, classifyError } from './classifier';

describe('classifyError', () => {
  it.each([
    ['missing_letter', 'receive', 'recive'],
    ['missing_letter', 'write', 'writ'],
    ['missing_letter', 'deadline', 'deadlne'],
    ['extra_letter', 'receipt', 'receiptt'],
    ['extra_letter', 'schedule', 'scheddule'],
    ['extra_letter', 'business', 'busiiness'],
    ['transposition', 'necessary', 'necesasry'],
    ['transposition', 'form', 'fomr'],
    ['transposition', 'state', 'tsate'],
    ['vowel_swap', 'receive', 'receeve'],
    ['vowel_swap', 'deaf', 'dafe'],
    ['vowel_swap', 'receive', 'receeve'],
    ['double_consonant_error', 'committee', 'comittee'],
    ['double_consonant_error', 'address', 'adress'],
    ['double_consonant_error', 'letter', 'leter'],
    ['silent_letter', 'write', 'writ'],
    ['silent_letter', 'knight', 'knigt'],
    ['silent_letter', 'there', 'ther'],
    ['suffix_error', 'definitely', 'definitly'],
    ['suffix_error', 'carefully', 'carefull'],
    ['suffix_error', 'lovely', 'lovly'],
    ['prefix_error', 'restate', 'state'],
    ['prefix_error', 'refund', 'fund'],
    ['prefix_error', 'unpack', 'pack'],
    ['similar_word_confusion', 'receive', 'receipt'],
    ['similar_word_confusion', 'separate', 'seperate'],
    ['similar_word_confusion', 'practice', 'practise'],
    ['phonetic_substitution', 'sence', 'sense'],
    ['phonetic_substitution', 'writting', 'writing'],
    ['phonetic_substitution', 'colour', 'color'],
    ['typing_adjacent_key', 'sad', 'aad'],
    ['typing_adjacent_key', 'mop', 'nop'],
    ['typing_adjacent_key', 'zebra', 'xebra'],
    ['missing_letter', 'travel', 'trvel']
  ])('classifies %s for %s vs %s', (expectedType, target, answer) => {
    expect(classifyError(target, answer)).toContain(expectedType);
  });

  it('detects a final adjacent-key typing slip', () => {
    expect(classifyError('hand', 'hnd')).not.toEqual([]);
    expect(classifyError('sad', 'aad')).toContain('typing_adjacent_key');
  });

  it('returns a clean red-pencil diff for a miss', () => {
    const diff = buildRedPencilDiff('definitely', 'definitly');
    expect(diff.issues).toContain('suffix_error');
    expect(diff.svg).toContain('<svg');
    expect(diff.svg).toContain('#d2402a');
    expect(diff.svg).toContain('aria-label="red-pencil diff"');
  });

  it('escapes user text in the SVG diff', () => {
    const diff = buildRedPencilDiff('a', '<');
    expect(diff.svg).toContain('&lt;');
    expect(diff.svg).not.toContain('><</text>');
  });

  it('keeps a matching answer as a no-op', () => {
    expect(classifyError('receive', 'receive')).toEqual([]);
  });

  it('returns other when no recognized pattern is found', () => {
    expect(classifyError('zebra', 'quartz')).toEqual(['other']);
  });
});
