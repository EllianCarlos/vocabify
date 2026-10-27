import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { VocabLookup } from '@extension/storage';
import { type DetectionResult, setLanguageDetector } from '../src/language';
import { replaceTextNodes, setVocab } from '../src/vocabify';

const lookup: VocabLookup = {
  do: { characters: '為', subjectType: 'kanji', srsStage: 1, level: 1 },
  one: { characters: '一', subjectType: 'kanji', srsStage: 1, level: 1 },
};

/** A fake detector: Portuguese if the text has "bairro" or "feira", otherwise English. */
const calls: string[] = [];
async function fakeDetector(text: string): Promise<DetectionResult> {
  calls.push(text);
  const language = /bairro|feira|são|não/i.test(text) ? 'pt' : 'en';
  return { isReliable: true, languages: [{ language, percentage: 95 }] };
}

const replaced = () => Array.from(document.querySelectorAll<HTMLElement>('.vocabify')).map(s => s.title);

const englishFiller = 'This sentence is long enough for a reliable language detection result.';
const portugueseFiller = 'Esta feira do bairro acontece todo sábado e não tem hora para acabar, são muitas barracas.';

beforeEach(() => {
  setVocab(lookup, true);
  setLanguageDetector(fakeDetector);
  calls.length = 0;
  document.documentElement.removeAttribute('lang');
  document.body.innerHTML = '';
});

afterEach(() => setLanguageDetector(null));

describe('language filter', () => {
  it('replaces words in English blocks only', async () => {
    document.body.innerHTML = `<p>${englishFiller} Do one thing.</p><p>${portugueseFiller} Feira do bairro.</p>`;
    await replaceTextNodes(document.body);
    expect(replaced()).toEqual(['Do', 'one']);
  });

  it('uses the page language for short blocks', async () => {
    document.body.innerHTML = `<p>${portugueseFiller}</p><p>Feira do bairro</p>`;
    await replaceTextNodes(document.body);
    expect(replaced()).toEqual([]);
  });

  it('uses <html lang> when the page text is too short to detect', async () => {
    document.documentElement.lang = 'pt-BR';
    document.body.innerHTML = '<p>Feira do bairro</p>';
    await replaceTextNodes(document.body);
    expect(replaced()).toEqual([]);

    document.documentElement.lang = 'en';
    setLanguageDetector(fakeDetector); // clears the cache
    await replaceTextNodes(document.body);
    expect(replaced()).toEqual(['do']);
  });

  it('respects a lang attribute on a block', async () => {
    document.body.innerHTML = `<p>${englishFiller} Do it.</p><p lang="pt">Do it.</p>`;
    await replaceTextNodes(document.body);
    expect(replaced()).toEqual(['Do']);
  });

  it('replaces short text on an English page', async () => {
    document.body.innerHTML = `<p>${englishFiller}</p><p>Do one</p>`;
    await replaceTextNodes(document.body);
    expect(replaced()).toEqual(['Do', 'one']);
  });

  it('does not run detection for text without matches', async () => {
    document.body.innerHTML = `<p>${portugueseFiller.replace(/ do /g, ' da ')}</p>`;
    await replaceTextNodes(document.body);
    expect(calls).toEqual([]);
  });

  it('falls back to English when there is no detector and no lang', async () => {
    setLanguageDetector(null);
    document.body.innerHTML = '<p>Feira do bairro</p>';
    await replaceTextNodes(document.body);
    expect(replaced()).toEqual(['do']);
  });
});
