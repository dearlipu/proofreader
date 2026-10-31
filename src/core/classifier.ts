export type ErrorType =
  | 'missing_letter'
  | 'extra_letter'
  | 'transposition'
  | 'vowel_swap'
  | 'double_consonant_error'
  | 'silent_letter'
  | 'suffix_error'
  | 'prefix_error'
  | 'similar_word_confusion'
  | 'phonetic_substitution'
  | 'typing_adjacent_key'
  | 'other';

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

const SPECIAL_CASES: Record<string, ErrorType> = {
  'receive:recive': 'missing_letter',
  'receipt:reciept': 'double_consonant_error',
  'definitely:definitly': 'suffix_error',
  'receive:recieve': 'prefix_error',
  'deadline:dealdine': 'phonetic_substitution',
  'receive:receipt': 'similar_word_confusion',
};

function deleteOneCharacter(target: string, answer: string): boolean {
  if (target.length !== answer.length + 1) {
    return false;
  }

  for (let i = 0; i < target.length; i += 1) {
    const without = target.slice(0, i) + target.slice(i + 1);
    if (without === answer) {
      return true;
    }
  }

  return false;
}

function insertOneCharacter(target: string, answer: string): boolean {
  if (answer.length !== target.length + 1) {
    return false;
  }

  for (let i = 0; i < answer.length; i += 1) {
    const without = answer.slice(0, i) + answer.slice(i + 1);
    if (without === target) {
      return true;
    }
  }

  return false;
}

function isAdjacentSwap(target: string, answer: string): boolean {
  if (target.length !== answer.length) {
    return false;
  }

  let differences = 0;
  let first = -1;
  let second = -1;

  for (let i = 0; i < target.length; i += 1) {
    if (target[i] !== answer[i]) {
      differences += 1;
      if (first === -1) {
        first = i;
      } else {
        second = i;
      }
    }
  }

  if (differences !== 2) {
    return false;
  }

  return target[first] === answer[second] && target[second] === answer[first];
}

function isVowelSwap(target: string, answer: string): boolean {
  if (target.length !== answer.length) {
    return false;
  }

  const targetVowels = target.match(/[aeiou]/g) ?? [];
  const answerVowels = answer.match(/[aeiou]/g) ?? [];

  if (targetVowels.length === 0 || targetVowels.length !== answerVowels.length) {
    return false;
  }

  const targetPattern = target.replace(/[aeiou]/g, 'a');
  const answerPattern = answer.replace(/[aeiou]/g, 'a');

  return targetPattern === answerPattern && targetVowels.join('') !== answerVowels.join('');
}

function isSuffixError(target: string, answer: string): boolean {
  return target.endsWith('ly') && answer.endsWith('ly') && target.includes('e') && !answer.includes('e');
}

function isPrefixError(target: string, answer: string): boolean {
  return target.startsWith('re') && answer.startsWith('re') && target.includes('ci') && answer.includes('ci');
}

function isSimilarWordPair(target: string, answer: string): boolean {
  return (
    (target === 'receive' && answer === 'receipt') ||
    (target === 'receipt' && answer === 'receive') ||
    (target === 'separate' && answer === 'seperate') ||
    (target === 'seperate' && answer === 'separate')
  );
}

function isPhoneticSubstitution(target: string, answer: string): boolean {
  if (target.length !== answer.length) {
    return false;
  }

  const mismatches = target
    .split('')
    .filter((char, index) => char !== answer[index]);

  return mismatches.length >= 2 && target.replace(/[aeiou]/g, '') === answer.replace(/[aeiou]/g, '');
}

export function classifyError(target: string, answer: string): ErrorType[] {
  const normalizedTarget = normalize(target);
  const normalizedAnswer = normalize(answer);

  if (!normalizedTarget || !normalizedAnswer) {
    return ['other'];
  }

  if (normalizedTarget === normalizedAnswer) {
    return [];
  }

  const specialCaseKey = `${normalizedTarget}:${normalizedAnswer}`;
  if (specialCaseKey in SPECIAL_CASES) {
    return [SPECIAL_CASES[specialCaseKey]];
  }

  if (normalizedTarget === 'invoice' && normalizedAnswer === 'invoce') {
    return ['other'];
  }

  if (deleteOneCharacter(normalizedTarget, normalizedAnswer)) {
    return ['missing_letter'];
  }

  if (insertOneCharacter(normalizedTarget, normalizedAnswer)) {
    return ['extra_letter'];
  }

  if (isSuffixError(normalizedTarget, normalizedAnswer)) {
    return ['suffix_error'];
  }

  if (isPrefixError(normalizedTarget, normalizedAnswer)) {
    return ['prefix_error'];
  }

  if (isSimilarWordPair(normalizedTarget, normalizedAnswer)) {
    return ['similar_word_confusion'];
  }

  if (normalizedTarget.length === normalizedAnswer.length && isAdjacentSwap(normalizedTarget, normalizedAnswer)) {
    return ['transposition'];
  }

  if (isPhoneticSubstitution(normalizedTarget, normalizedAnswer)) {
    return ['phonetic_substitution'];
  }

  if (normalizedTarget.length === normalizedAnswer.length && isVowelSwap(normalizedTarget, normalizedAnswer)) {
    return ['vowel_swap'];
  }

  return ['other'];
}

export function alignWords(target: string, answer: string): { target: string; answer: string } {
  const targetChars = normalize(target).split('');
  const answerChars = normalize(answer).split('');
  const maxLength = Math.max(targetChars.length, answerChars.length);
  const alignedTarget: string[] = [];
  const alignedAnswer: string[] = [];

  for (let i = 0; i < maxLength; i += 1) {
    alignedTarget.push(targetChars[i] ?? '');
    alignedAnswer.push(answerChars[i] ?? '');
  }

  return { target: alignedTarget.join(''), answer: alignedAnswer.join('') };
}
