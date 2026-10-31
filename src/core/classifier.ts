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

export type RedPencilDiff = {
  svg: string;
  issues: ErrorType[];
};

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

const PREFIXES = ['re', 'un', 'in', 'dis', 'over', 'out', 'up', 'pre'];
const KEYBOARD_NEIGHBORS: Record<string, string[]> = {
  q: ['w'],
  w: ['q', 'e'],
  e: ['w', 'r'],
  r: ['e', 't'],
  t: ['r', 'y'],
  y: ['t', 'u'],
  u: ['y', 'i'],
  i: ['u', 'o'],
  o: ['i', 'p'],
  p: ['o'],
  a: ['s'],
  s: ['a', 'd', 'w'],
  d: ['s', 'f', 'e'],
  f: ['d', 'g', 'r'],
  g: ['f', 'h', 't'],
  h: ['g', 'j', 'y'],
  j: ['h', 'k', 'u'],
  k: ['j', 'l', 'i'],
  l: ['k', 'o'],
  z: ['x'],
  x: ['z', 'c'],
  c: ['x', 'v'],
  v: ['c', 'b'],
  b: ['v', 'n'],
  n: ['b', 'm'],
  m: ['n'],
};

function countMismatches(target: string, answer: string): number {
  const max = Math.max(target.length, answer.length);
  let mismatches = 0;

  for (let index = 0; index < max; index += 1) {
    if (target[index] !== answer[index]) {
      mismatches += 1;
    }
  }

  return mismatches;
}

function isAdjacentSwap(target: string, answer: string): boolean {
  if (target.length !== answer.length) {
    return false;
  }

  const mismatches: number[] = [];
  for (let index = 0; index < target.length; index += 1) {
    if (target[index] !== answer[index]) {
      mismatches.push(index);
    }
  }

  if (mismatches.length !== 2) {
    return false;
  }

  const [first, second] = mismatches;
  return target[first] === answer[second] && target[second] === answer[first];
}

function isAdjacentKeyPair(left: string, right: string): boolean {
  if (!left || !right) {
    return false;
  }

  return (KEYBOARD_NEIGHBORS[left] ?? []).includes(right) || (KEYBOARD_NEIGHBORS[right] ?? []).includes(left);
}

function isMissingLetter(target: string, answer: string): boolean {
  if (target.length !== answer.length + 1) {
    return false;
  }

  for (let index = 0; index < target.length; index += 1) {
    const without = target.slice(0, index) + target.slice(index + 1);
    if (without === answer) {
      return true;
    }
  }

  return false;
}

function isExtraLetter(target: string, answer: string): boolean {
  if (answer.length !== target.length + 1) {
    return false;
  }

  for (let index = 0; index < answer.length; index += 1) {
    const without = answer.slice(0, index) + answer.slice(index + 1);
    if (without === target) {
      return true;
    }
  }

  return false;
}

function isDoubleConsonantError(target: string, answer: string): boolean {
  const repeated = /(bb|cc|dd|ff|gg|hh|jj|kk|ll|mm|nn|pp|qq|rr|ss|tt|vv|ww|xx|yy|zz)/.exec(target);
  if (!repeated) {
    return false;
  }

  const repeatedText = repeated[0];
  const normalizedTarget = target.replace(repeatedText, repeatedText[0]);
  return normalizedTarget === answer;
}

function isSilentLetterError(target: string, answer: string): boolean {
  if (Math.abs(target.length - answer.length) > 1) {
    return false;
  }

  const silentLetters = ['e', 'h', 'k', 'w'];
  return silentLetters.some((letter) => {
    const strip = (value: string): string => value.split(letter).join('');
    const targetWithout = strip(target);
    const answerWithout = strip(answer);
    return targetWithout === answer || answerWithout === target || targetWithout === answerWithout;
  });
}

function isSuffixError(target: string, answer: string): boolean {
  if (target === answer) {
    return false;
  }

  if (target.endsWith('ly') && (answer === target.slice(0, -1) || answer === target.replace(/e(?=ly$)/, ''))) {
    return true;
  }

  if (answer.endsWith('ly') && (target === answer.slice(0, -1) || target === answer.replace(/e(?=ly$)/, ''))) {
    return true;
  }

  return false;
}

function isPrefixError(target: string, answer: string): boolean {
  return PREFIXES.some((prefix) => target.startsWith(prefix) && answer === target.slice(prefix.length));
}

function isSimilarWordPair(target: string, answer: string): boolean {
  const pairs = [
    ['receive', 'receipt'],
    ['separate', 'seperate'],
    ['advice', 'advise'],
    ['practice', 'practise'],
  ];

  return pairs.some(([left, right]) =>
    (target === left && answer === right) || (target === right && answer === left)
  );
}

function isVowelSwap(target: string, answer: string): boolean {
  if (target.length !== answer.length || target === answer) {
    return false;
  }

  const targetVowels = target.match(/[aeiou]/g) ?? [];
  const answerVowels = answer.match(/[aeiou]/g) ?? [];
  if (targetVowels.length < 2 || targetVowels.length !== answerVowels.length) {
    return false;
  }

  const targetConsonants = target.replace(/[aeiou]/g, '');
  const answerConsonants = answer.replace(/[aeiou]/g, '');
  return targetConsonants === answerConsonants && targetVowels.join('') !== answerVowels.join('');
}

function isPhoneticSubstitution(target: string, answer: string): boolean {
  if (Math.abs(target.length - answer.length) > 1) {
    return false;
  }

  if (isTypingAdjacentKey(target, answer) || isAdjacentSwap(target, answer)) {
    return false;
  }

  const collapsedTarget = target.replace(/([a-z])\1+/g, '$1');
  const collapsedAnswer = answer.replace(/([a-z])\1+/g, '$1');
  if (collapsedTarget === answer || collapsedAnswer === target) {
    return true;
  }

  const mismatchCount = countMismatches(target, answer);
  if (mismatchCount < 1 || mismatchCount > 2) {
    return false;
  }

  const targetVowels = (target.match(/[aeiou]/g) ?? []).join('');
  const answerVowels = (answer.match(/[aeiou]/g) ?? []).join('');
  const sameVowelPattern = targetVowels.length === answerVowels.length && countMismatches(targetVowels, answerVowels) <= 1;
  const sameConsonantSkeleton = target.replace(/[aeiou]/g, '') === answer.replace(/[aeiou]/g, '');

  return sameVowelPattern || sameConsonantSkeleton;
}

function isTypingAdjacentKey(target: string, answer: string): boolean {
  if (target.length !== answer.length) {
    return false;
  }

  const mismatches: Array<[string, string]> = [];
  for (let index = 0; index < target.length; index += 1) {
    if (target[index] !== answer[index]) {
      mismatches.push([target[index], answer[index]]);
    }
  }

  if (mismatches.length !== 1) {
    return false;
  }

  const [left, right] = mismatches[0];
  return isAdjacentKeyPair(left, right);
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

  const issues: ErrorType[] = [];

  if (isSimilarWordPair(normalizedTarget, normalizedAnswer)) {
    issues.push('similar_word_confusion');
  }

  if (isPrefixError(normalizedTarget, normalizedAnswer)) {
    issues.push('prefix_error');
  }

  if (isSuffixError(normalizedTarget, normalizedAnswer)) {
    issues.push('suffix_error');
  }

  if (isSilentLetterError(normalizedTarget, normalizedAnswer)) {
    issues.push('silent_letter');
  }

  if (isVowelSwap(normalizedTarget, normalizedAnswer)) {
    issues.push('vowel_swap');
  }

  if (isTypingAdjacentKey(normalizedTarget, normalizedAnswer)) {
    issues.push('typing_adjacent_key');
  }

  if (isAdjacentSwap(normalizedTarget, normalizedAnswer)) {
    issues.push('transposition');
  }

  if (isDoubleConsonantError(normalizedTarget, normalizedAnswer)) {
    issues.push('double_consonant_error');
  }

  if (isMissingLetter(normalizedTarget, normalizedAnswer)) {
    issues.push('missing_letter');
  }

  if (isExtraLetter(normalizedTarget, normalizedAnswer)) {
    issues.push('extra_letter');
  }

  if (isPhoneticSubstitution(normalizedTarget, normalizedAnswer)) {
    issues.push('phonetic_substitution');
  }

  if (issues.length === 0) {
    return ['other'];
  }

  return issues;
}

export function alignWords(target: string, answer: string): { target: string; answer: string } {
  const left = normalize(target).split('');
  const right = normalize(answer).split('');
  const targetChars: string[] = [];
  const answerChars: string[] = [];
  let i = 0;
  let j = 0;

  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i] === right[j]) {
      targetChars.push(left[i]);
      answerChars.push(right[j]);
      i += 1;
      j += 1;
      continue;
    }

    if (i + 1 < left.length && j + 1 < right.length && left[i] === right[j + 1] && left[i + 1] === right[j]) {
      targetChars.push(left[i], left[i + 1]);
      answerChars.push(right[j], right[j + 1]);
      i += 2;
      j += 2;
      continue;
    }

    targetChars.push(left[i] ?? '');
    answerChars.push(right[j] ?? '');

    if (i < left.length) {
      i += 1;
    }
    if (j < right.length) {
      j += 1;
    }
  }

  return { target: targetChars.join(''), answer: answerChars.join('') };
}

export function buildRedPencilDiff(target: string, answer: string): RedPencilDiff {
  const aligned = alignWords(target, answer);
  const targetChars = aligned.target.split('');
  const answerChars = aligned.answer.split('');
  const issues = classifyError(target, answer);

  const pieces: string[] = [];
  for (let index = 0; index < Math.max(targetChars.length, answerChars.length); index += 1) {
    const targetChar = targetChars[index] ?? '';
    const answerChar = answerChars[index] ?? '';

    if (!targetChar && answerChar) {
      pieces.push(
        `<g transform="translate(${index * 18}, 0)"><text x="0" y="20" fill="#d2402a" font-size="18" font-family="IBM Plex Mono, monospace">${answerChar}</text><path d="M0 18 L12 18" stroke="#d2402a" stroke-width="2"/></g>`
      );
      continue;
    }

    if (targetChar && !answerChar) {
      pieces.push(
        `<g transform="translate(${index * 18}, 0)"><text x="0" y="20" fill="#17181b" font-size="18" font-family="IBM Plex Mono, monospace" text-decoration="line-through">${targetChar}</text><path d="M0 15 L12 15" stroke="#d2402a" stroke-width="2"/><text x="6" y="8" fill="#d2402a" font-size="12" font-family="IBM Plex Mono, monospace">^</text></g>`
      );
      continue;
    }

    if (targetChar === answerChar) {
      pieces.push(
        `<text x="${index * 18}" y="20" fill="#17181b" font-size="18" font-family="IBM Plex Mono, monospace">${targetChar}</text>`
      );
      continue;
    }

    pieces.push(
      `<g transform="translate(${index * 18}, 0)"><text x="0" y="20" fill="#d2402a" font-size="18" font-family="IBM Plex Mono, monospace" text-decoration="line-through">${targetChar}</text><text x="12" y="8" fill="#2d4e86" font-size="12" font-family="IBM Plex Mono, monospace">${answerChar}</text><path d="M2 15 Q6 8 10 15" stroke="#d2402a" stroke-width="2" fill="none"/></g>`
    );
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.max(80, pieces.length * 18)}" height="28" role="img" aria-label="red-pencil diff"><g>${pieces.join('')}</g></svg>`;

  return { svg, issues };
}
