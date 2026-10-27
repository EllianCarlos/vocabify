/**
 * Fast, allocation-light phrase matcher.
 *
 * The previous implementation compiled every meaning into one large regex
 * alternation (`\b(a|b|c|...)\b`) and ran it against every text node. With a
 * few thousand meanings that regex is slow to compile and slow to run.
 *
 * This matcher tokenises the text once and looks phrases up in a Map, so the
 * cost is O(tokens * maxWordsInPhrase) instead of O(text * alternatives).
 */

// A word: letters/digits/marks, optionally joined by internal apostrophes.
const WORD_RE = /[\p{L}\p{N}\p{M}]+(?:['’][\p{L}\p{N}\p{M}]+)*/gu;
// A key is valid if it is words separated only by single spaces or hyphens.
const VALID_KEY_RE =
  /^[\p{L}\p{N}\p{M}]+(?:['’][\p{L}\p{N}\p{M}]+)*(?:[ -][\p{L}\p{N}\p{M}]+(?:['’][\p{L}\p{N}\p{M}]+)*)*$/u;
// Separators allowed between words inside one phrase.
const SEPARATOR_RE = /^(?:\s+|-)$/;

/** Canonical form used for lookup keys and for matched text. */
export function normalizeKey(text: string): string {
  return text.toLowerCase().replace(/’/g, "'").replace(/\s+/g, ' ').trim();
}

export interface Match {
  start: number;
  end: number;
  /** The matched text as it appears in the page. */
  text: string;
  /** The normalised lookup key. */
  key: string;
}

export class PhraseMatcher {
  private readonly keys: Set<string>;
  private readonly firstWords: Set<string>;
  private readonly maxWords: number;

  constructor(phrases: Iterable<string>) {
    this.keys = new Set();
    this.firstWords = new Set();
    let maxWords = 0;
    for (const phrase of phrases) {
      const key = normalizeKey(phrase);
      // Phrases with leading/trailing punctuation (e.g. "-ese", "Mr.") cannot
      // be matched reliably on word boundaries, so they are ignored.
      if (!VALID_KEY_RE.test(key)) continue;
      this.keys.add(key);
      const words = key.match(WORD_RE) ?? [key];
      this.firstWords.add(words[0]!);
      maxWords = Math.max(maxWords, words.length);
    }
    this.maxWords = maxWords;
  }

  get size(): number {
    return this.keys.size;
  }

  has(key: string): boolean {
    return this.keys.has(key);
  }

  /**
   * Returns non-overlapping matches, scanning left to right and preferring the
   * longest phrase at each position.
   */
  findAll(text: string): Match[] {
    if (this.keys.size === 0) return [];
    const starts: number[] = [];
    const ends: number[] = [];
    const words: string[] = [];
    WORD_RE.lastIndex = 0;
    for (let m = WORD_RE.exec(text); m !== null; m = WORD_RE.exec(text)) {
      starts.push(m.index);
      ends.push(m.index + m[0].length);
      words.push(m[0].toLowerCase().replace(/’/g, "'"));
    }

    const matches: Match[] = [];
    let i = 0;
    while (i < words.length) {
      if (!this.firstWords.has(words[i])) {
        i++;
        continue;
      }
      let found = 0;
      let key = words[i];
      let bestKey = '';
      const limit = Math.min(this.maxWords, words.length - i);
      for (let n = 1; n <= limit; n++) {
        if (n > 1) {
          const separator = text.slice(ends[i + n - 2], starts[i + n - 1]);
          if (!SEPARATOR_RE.test(separator)) break;
          key += (separator === '-' ? '-' : ' ') + words[i + n - 1];
        }
        if (this.keys.has(key)) {
          found = n;
          bestKey = key;
        }
      }
      if (found === 0) {
        i++;
        continue;
      }
      const start = starts[i];
      const end = ends[i + found - 1];
      matches.push({ start, end, text: text.slice(start, end), key: bestKey });
      i += found;
    }
    return matches;
  }
}
