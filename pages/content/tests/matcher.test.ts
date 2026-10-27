import { describe, expect, it } from 'vitest';
import { normalizeKey, PhraseMatcher } from '../src/matcher';

const keys = (matcher: PhraseMatcher, text: string) => matcher.findAll(text).map(m => m.text);

describe('PhraseMatcher', () => {
  it('matches whole words only, case-insensitively', () => {
    const matcher = new PhraseMatcher(['one', 'person']);
    expect(keys(matcher, 'One person, someone, personal.')).toEqual(['One', 'person']);
  });

  it('prefers the longest phrase', () => {
    const matcher = new PhraseMatcher(['big', 'big brother', 'brother']);
    expect(keys(matcher, 'My big brother and big dog')).toEqual(['big brother', 'big']);
  });

  it('allows any whitespace between words of a phrase', () => {
    const matcher = new PhraseMatcher(['big brother']);
    expect(keys(matcher, 'big\n   brother')).toEqual(['big\n   brother']);
    expect(keys(matcher, 'big, brother')).toEqual([]);
  });

  it('matches hyphenated phrases and apostrophes, including curly ones', () => {
    const matcher = new PhraseMatcher(['ten-thousand', "one's"]);
    expect(keys(matcher, 'Ten-thousand of one’s own')).toEqual(['Ten-thousand', 'one’s']);
  });

  it('does not match a word inside a contraction', () => {
    const matcher = new PhraseMatcher(['don']);
    expect(keys(matcher, "don't")).toEqual([]);
  });

  it('ignores keys that cannot be matched on word boundaries', () => {
    const matcher = new PhraseMatcher(['-ese', 'mr.', 'ok']);
    expect(matcher.size).toBe(1);
  });

  it('gives positions in the original text', () => {
    const matcher = new PhraseMatcher(['dog']);
    const [match] = matcher.findAll('a dog!');
    expect(match).toEqual({ start: 2, end: 5, text: 'dog', key: 'dog' });
  });

  it('works with non-Latin text', () => {
    const matcher = new PhraseMatcher(['café']);
    expect(keys(matcher, 'Un CAFÉ, s’il vous plaît')).toEqual(['CAFÉ']);
  });

  it('normalizes keys', () => {
    expect(normalizeKey('  Big\tBrother’s ')).toBe("big brother's");
  });

  it('returns nothing when empty', () => {
    expect(new PhraseMatcher([]).findAll('anything')).toEqual([]);
  });
});
