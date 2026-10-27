import { describe, expect, it } from 'vitest';
import type { SimplifiedVocab, VocabEntry } from '@extension/storage';
import { decide, posScore, tagWordAt, wanikaniPos } from '../src/sense';
import { sentenceAt } from '../src/context';

const vocab = (subjectId: number, characters: string, partsOfSpeech?: string[]): SimplifiedVocab => ({
  subjectId,
  characters,
  subjectType: partsOfSpeech ? 'vocabulary' : 'kanji',
  srsStage: 1,
  level: 1,
  partsOfSpeech,
});

const saki = vocab(1, '先', ['noun']);
const hinto = vocab(2, 'ヒント', ['noun']);
const tip: VocabEntry = { ...saki, alternatives: [hinto] };

/** Decides for the first occurrence of `word` in `sentence`. */
const decideIn = (entry: VocabEntry, sentence: string, word: string, useModel = true) =>
  decide(entry, word.toLowerCase(), sentenceAt(sentence, sentence.indexOf(word)), useModel);

describe('tagWordAt', () => {
  it('tags words in context', () => {
    expect(tagWordAt('Do you tip the waiter?', 7)).toBe('verb');
    expect(tagWordAt('It is just the tip of the iceberg.', 15)).toBe('noun');
    expect(tagWordAt('I like big dogs.', 7)).toBe('adjective');
    expect(tagWordAt('He is my big brother.', 0)).toBe('pronoun');
    expect(tagWordAt('One person came.', 0)).toBe('number');
    expect(tagWordAt('The play was long.', 0)).toBe('function');
  });
});

describe('wanikaniPos', () => {
  it('maps WaniKani parts of speech', () => {
    expect(wanikaniPos(['noun', 'する verb'])).toEqual(new Set(['noun', 'verb']));
    expect(wanikaniPos(['godan verb', 'intransitive verb'])).toEqual(new Set(['verb']));
    expect(wanikaniPos(['い adjective'])).toEqual(new Set(['adjective']));
    expect(wanikaniPos(['numeral'])).toEqual(new Set(['number', 'noun']));
    expect(wanikaniPos(['expression'])).toBeNull();
    expect(wanikaniPos(undefined)).toBeNull();
  });
});

describe('posScore', () => {
  it('scores exact, loose and conflicting parts of speech', () => {
    expect(posScore(saki, 'noun')).toBe(2);
    expect(posScore(saki, 'adjective')).toBe(1);
    expect(posScore(saki, 'verb')).toBe(0);
    expect(posScore(vocab(3, '大'), 'adjective')).toBe(1);
    expect(posScore(vocab(3, '大'), 'function')).toBe(0);
  });
});

describe('decide', () => {
  it('asks the model when two nouns fit', () => {
    expect(decideIn(tip, 'It is just the tip of the iceberg.', 'tip')).toEqual({
      kind: 'ask',
      candidates: [saki, hinto],
    });
  });

  it('uses the first translation when the model is off', () => {
    expect(decideIn(tip, 'Hint or Tip: press the button.', 'Tip', false)).toEqual({ kind: 'replace', vocab: saki });
  });

  it('skips a verb when all translations are nouns', () => {
    expect(decideIn(tip, 'Do you tip the waiter?', 'tip')).toEqual({ kind: 'skip' });
  });

  it('prefers an exact part-of-speech match', () => {
    const big: VocabEntry = { ...vocab(4, '大'), alternatives: [vocab(5, '大きい', ['い adjective'])] };
    expect(decideIn(big, 'I like big dogs.', 'big')).toEqual({ kind: 'replace', vocab: big.alternatives![0] });
  });

  it('does not replace a function word with a kanji', () => {
    const doKanji: VocabEntry = vocab(6, '為');
    expect(decideIn(doKanji, 'Do you like it?', 'Do')).toEqual({ kind: 'skip' });
    expect(decideIn(doKanji, 'I do my homework.', 'do')).toEqual({ kind: 'replace', vocab: doKanji });
  });

  it('does not use part-of-speech rules for phrases', () => {
    const entry: VocabEntry = vocab(7, '兄', ['noun']);
    expect(decide(entry, 'big brother', sentenceAt('Big brother is watching.', 0), true)).toEqual({
      kind: 'replace',
      vocab: entry,
    });
  });
});

describe('sentenceAt', () => {
  it('returns the sentence around a position', () => {
    const text = 'First sentence here. It is just the tip of the iceberg. Last one.';
    const position = text.indexOf('tip');
    const context = sentenceAt(text, position);
    expect(context.sentence).toBe('It is just the tip of the iceberg.');
    expect(context.sentence.slice(context.start, context.start + 3)).toBe('tip');
  });
});
