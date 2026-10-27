import { describe, expect, it } from 'vitest';
import { buildVocabLookup, compareVocab, type VocabSrsStage } from '../../lib/wanikani/vocab';
import type { SubjectResponse, SubjectType } from '@extension/shared';

function subject(
  id: number,
  object: SubjectType,
  characters: string | null,
  meanings: string[],
  srsStage = 1,
  extra: { parts_of_speech?: string[]; context_sentences?: { en: string; ja: string }[] } = {},
): VocabSrsStage {
  const data = {
    characters,
    level: 1,
    meanings: meanings.map((meaning, i) => ({ meaning, primary: i === 0, accepted_answer: true })),
    ...(object === 'vocabulary' || object === 'kana_vocabulary'
      ? { parts_of_speech: [], context_sentences: [], ...extra }
      : {}),
  };
  return { vocab: { id, object, data } as unknown as SubjectResponse, srsStage };
}

describe('buildVocabLookup', () => {
  it('keeps one subject per key when there is no ambiguity', () => {
    const lookup = buildVocabLookup([subject(1, 'vocabulary', '人', ['Person'], 2, { parts_of_speech: ['noun'] })]);
    expect(lookup).toEqual({
      person: {
        subjectId: 1,
        characters: '人',
        subjectType: 'vocabulary',
        srsStage: 2,
        level: 1,
        partsOfSpeech: ['noun'],
      },
    });
  });

  it('keeps alternatives with context when an English word has more than one translation', () => {
    const lookup = buildVocabLookup([
      subject(10, 'kana_vocabulary', 'ヒント', ['Hint', 'Tip'], 3, {
        parts_of_speech: ['noun'],
        context_sentences: [{ en: 'Give me a hint.', ja: 'ヒントをください。' }],
      }),
      subject(11, 'vocabulary', '先', ['Tip', 'Point'], 3, {
        parts_of_speech: ['noun'],
        context_sentences: [{ en: 'The tip of the pen.', ja: 'ペンの先。' }],
      }),
    ]);
    // Same SRS stage: vocabulary before kana vocabulary.
    expect(lookup.tip.characters).toBe('先');
    expect(lookup.tip.meanings).toEqual(['Tip', 'Point']);
    expect(lookup.tip.contextSentences).toEqual(['The tip of the pen.']);
    expect(lookup.tip.alternatives).toEqual([
      {
        subjectId: 10,
        characters: 'ヒント',
        subjectType: 'kana_vocabulary',
        srsStage: 3,
        level: 1,
        partsOfSpeech: ['noun'],
        meanings: ['Hint', 'Tip'],
        contextSentences: ['Give me a hint.'],
      },
    ]);
    // Keys with only one subject keep no context.
    expect(lookup.hint.alternatives).toBeUndefined();
    expect(lookup.hint.contextSentences).toBeUndefined();
  });

  it('treats subjects with the same characters as one translation', () => {
    const lookup = buildVocabLookup([subject(1, 'kanji', '一', ['One']), subject(2, 'vocabulary', '一', ['One'])]);
    expect(lookup.one.subjectId).toBe(2);
    expect(lookup.one.alternatives).toBeUndefined();
  });

  it('skips subjects without characters', () => {
    expect(buildVocabLookup([subject(1, 'radical', null, ['Stick'])])).toEqual({});
  });
});

describe('compareVocab', () => {
  it('orders by SRS stage, then subject type, then id', () => {
    const items = [
      subject(5, 'radical', 'a', ['x'], 1),
      subject(4, 'kanji', 'b', ['x'], 1),
      subject(3, 'vocabulary', 'c', ['x'], 2),
      subject(2, 'kana_vocabulary', 'd', ['x'], 1),
      subject(1, 'vocabulary', 'e', ['x'], 1),
    ];
    expect(items.sort(compareVocab).map(item => item.vocab.id)).toEqual([1, 2, 4, 5, 3]);
  });
});
