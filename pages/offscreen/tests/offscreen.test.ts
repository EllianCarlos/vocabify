import { describe, expect, it } from 'vitest';
import { choose, classify, distinctTexts, scoreCandidates } from '../src/classifier';
import { sha256 } from '../src/model';
import { WordPieceTokenizer } from '../src/tokenizer';

const vocab = ['[PAD]', '[UNK]', '[CLS]', '[SEP]', 'the', 'tip', 'of', 'ice', '##berg', 'cafe', ':', '.', '日', '本'];
const tokenizer = new WordPieceTokenizer({
  model: { vocab: Object.fromEntries(vocab.map((token, id) => [token, id])) },
});
const ids = (text: string) => tokenizer.encode(text).ids.map(id => vocab[id]);

describe('WordPieceTokenizer', () => {
  it('lowercases, splits punctuation and uses word pieces', () => {
    expect(ids('The tip of the Iceberg.')).toEqual(['[CLS]', 'the', 'tip', 'of', 'the', 'ice', '##berg', '.', '[SEP]']);
  });

  it('strips accents and splits CJK characters', () => {
    expect(ids('Café:日本')).toEqual(['[CLS]', 'cafe', ':', '日', '本', '[SEP]']);
  });

  it('uses [UNK] for unknown words and respects the maximum length', () => {
    expect(ids('tipx')).toEqual(['[CLS]', '[UNK]', '[SEP]']);
    expect(tokenizer.encode('tip tip tip tip tip', 4).ids).toHaveLength(4);
  });
});

const v = (...values: number[]) => Float32Array.from(values);

describe('classifier', () => {
  it('scores each candidate by its most similar text', () => {
    const scores = scoreCandidates(v(1, 0), [
      { subjectId: 1, vectors: [v(0, 1), v(0.8, 0.6)] },
      { subjectId: 2, vectors: [v(0.6, 0.8)] },
    ]);
    expect(scores.map(s => Number(s.score.toFixed(2)))).toEqual([0.8, 0.6]);
  });

  it('returns null when the margin is too small', () => {
    expect(
      choose(
        [
          { subjectId: 1, score: 0.5 },
          { subjectId: 2, score: 0.49 },
        ],
        0.02,
      ).subjectId,
    ).toBeNull();
    expect(
      choose(
        [
          { subjectId: 1, score: 0.5 },
          { subjectId: 2, score: 0.4 },
        ],
        0.02,
      ).subjectId,
    ).toBe(1);
    expect(choose([{ subjectId: 1, score: -1 }]).subjectId).toBeNull();
  });

  it('removes texts that all candidates share', () => {
    expect(
      distinctTexts([
        { subjectId: 1, texts: ['Date', 'today'] },
        { subjectId: 2, texts: ['Date', 'romance'] },
      ]),
    ).toEqual([
      { subjectId: 1, texts: ['today'] },
      { subjectId: 2, texts: ['romance'] },
    ]);
  });

  it('classifies a batch with one embedding call', async () => {
    const vectors: Record<string, Float32Array> = {
      'a sentence about money': v(1, 0),
      'a sentence about rivers': v(0, 1),
      money: v(0.9, 0.1),
      river: v(0.1, 0.9),
    };
    const calls: string[][] = [];
    const embed = async (texts: string[]) => {
      calls.push(texts);
      return texts.map(text => vectors[text]);
    };
    const candidates = [
      { subjectId: 5, texts: ['money'] },
      { subjectId: 6, texts: ['river'] },
    ];
    const choices = await classify(embed, [
      { sentence: 'a sentence about money', start: 0, word: 'bank', candidates },
      { sentence: 'a sentence about rivers', start: 0, word: 'bank', candidates },
    ]);
    expect(choices.map(choice => choice.subjectId)).toEqual([5, 6]);
    expect(calls).toHaveLength(1);
  });
});

describe('sha256', () => {
  it('returns the hex digest', async () => {
    const data = new TextEncoder().encode('abc').buffer as ArrayBuffer;
    expect(await sha256(data)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
