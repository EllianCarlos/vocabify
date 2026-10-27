import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { VocabLookup } from '@extension/storage';
import {
  flushPending,
  replaceTextNodes,
  restyle,
  reverseVocabify,
  setVocab,
  startObserving,
  stopObserving,
} from '../src/vocabify';

const lookup: VocabLookup = {
  one: { characters: '一', subjectType: 'kanji', srsStage: 1, level: 1 },
  person: { characters: '人', subjectType: 'kanji', srsStage: 1, level: 1 },
  'big brother': { characters: '兄', subjectType: 'vocabulary', srsStage: 2, level: 3 },
};

const spans = () => Array.from(document.querySelectorAll<HTMLElement>('.vocabify'));

beforeEach(() => {
  setVocab(lookup, true);
  document.body.innerHTML = '';
});

afterEach(() => {
  stopObserving();
});

describe('replaceTextNodes', () => {
  it('replaces words with styled spans and keeps the original as title', () => {
    document.body.innerHTML = '<p>One person and my Big Brother.</p>';
    replaceTextNodes(document.body);
    expect(document.body.textContent).toBe('一 人 and my 兄.');
    const [first, , third] = spans();
    expect(first.tagName).toBe('SPAN');
    expect(first.title).toBe('One');
    expect(first.classList.contains('vocabify-kanji')).toBe(true);
    expect(third.getAttribute('data-vocabify-subject-type')).toBe('vocabulary');
    expect(third.getAttribute('data-vocabify-level')).toBe('3');
  });

  it('does not touch editable fields, code or scripts', () => {
    document.body.innerHTML = `
      <textarea>one</textarea>
      <input value="one">
      <div contenteditable="true"><p>one</p></div>
      <div contenteditable="false">one</div>
      <pre><code>one</code></pre>
      <script>var one = 1;</script>
      <style>.one {}</style>
      <svg><text>one</text></svg>`;
    replaceTextNodes(document.body);
    expect(spans()).toHaveLength(1);
    expect(spans()[0].parentElement?.getAttribute('contenteditable')).toBe('false');
    expect(document.querySelector('textarea')?.value).toBe('one');
    expect(document.querySelector('script')?.textContent).toBe('var one = 1;');
  });

  it('does not process its own spans twice', () => {
    document.body.innerHTML = '<p>one</p>';
    replaceTextNodes(document.body);
    replaceTextNodes(document.body);
    expect(spans()).toHaveLength(1);
    expect(document.body.textContent).toBe('一');
  });

  it('updates and removes existing spans when the vocabulary changes', () => {
    document.body.innerHTML = '<p>one person</p>';
    replaceTextNodes(document.body);
    setVocab({ one: { characters: '壱', subjectType: 'vocabulary', srsStage: 1, level: 2 } }, true);
    replaceTextNodes(document.body, true);
    expect(document.body.textContent).toBe('壱 person');
    expect(spans()[0].classList.contains('vocabify-vocabulary')).toBe(true);
    expect(spans()[0].classList.contains('vocabify-kanji')).toBe(false);
  });
});

describe('reverseVocabify and restyle', () => {
  it('restores the original text', () => {
    document.body.innerHTML = '<p>One person</p>';
    replaceTextNodes(document.body);
    reverseVocabify();
    expect(spans()).toHaveLength(0);
    expect(document.body.textContent).toBe('One person');
  });

  it('switches between styled and unstyled classes', () => {
    document.body.innerHTML = '<p>one</p>';
    replaceTextNodes(document.body);
    restyle(false);
    expect(spans()[0].className).toBe('vocabify vocabify-kanji-no-style');
    restyle(true);
    expect(spans()[0].className).toBe('vocabify vocabify-kanji');
  });
});

describe('observer', () => {
  it('replaces text in added nodes and in changed text', async () => {
    document.body.innerHTML = '<p id="p">nothing</p>';
    startObserving(document.body);
    const added = document.createElement('div');
    added.textContent = 'one';
    document.body.appendChild(added);
    (document.getElementById('p')!.firstChild as Text).data = 'person';
    await Promise.resolve(); // let the observer deliver its records
    flushPending();
    expect(document.body.textContent).toBe('人一');
  });

  it('ignores the changes it makes itself', async () => {
    document.body.innerHTML = '';
    startObserving(document.body);
    document.body.append('one');
    await Promise.resolve();
    flushPending();
    await Promise.resolve();
    flushPending();
    expect(spans()).toHaveLength(1);
  });
});
