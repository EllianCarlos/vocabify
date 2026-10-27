import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { VocabLookup } from '@extension/storage';
import {
  flushPending,
  replaceTextNodes,
  restyle,
  reverseVocabify,
  type SenseRequest,
  setSenseResolver,
  setVocab,
  settle,
  startObserving,
  stopObserving,
} from '../src/vocabify';

const lookup: VocabLookup = {
  one: { subjectId: 1, characters: '一', subjectType: 'kanji', srsStage: 1, level: 1 },
  person: { subjectId: 2, characters: '人', subjectType: 'kanji', srsStage: 1, level: 1 },
  'big brother': { subjectId: 3, characters: '兄', subjectType: 'vocabulary', srsStage: 2, level: 3 },
  tip: {
    subjectId: 4,
    characters: '先',
    subjectType: 'vocabulary',
    srsStage: 1,
    level: 2,
    partsOfSpeech: ['noun'],
    meanings: ['Tip', 'Point'],
    contextSentences: ['The tip of the pen is sharp.'],
    alternatives: [
      {
        subjectId: 5,
        characters: 'ヒント',
        subjectType: 'kana_vocabulary',
        srsStage: 1,
        level: 3,
        partsOfSpeech: ['noun'],
        meanings: ['Hint', 'Tip'],
        contextSentences: ['Give me a hint.'],
      },
    ],
  },
};

const spans = () => Array.from(document.querySelectorAll<HTMLElement>('.vocabify'));

beforeEach(() => {
  setVocab(lookup, true);
  document.body.innerHTML = '';
});

afterEach(() => {
  stopObserving();
  setSenseResolver(null);
});

describe('replaceTextNodes', () => {
  it('replaces words with styled spans and keeps the original as title', async () => {
    document.body.innerHTML = '<p>One person and my Big Brother.</p>';
    await replaceTextNodes(document.body);
    expect(document.body.textContent).toBe('一 人 and my 兄.');
    const [first, , third] = spans();
    expect(first.tagName).toBe('SPAN');
    expect(first.title).toBe('One');
    expect(first.classList.contains('vocabify-kanji')).toBe(true);
    expect(third.getAttribute('data-vocabify-subject-type')).toBe('vocabulary');
    expect(third.getAttribute('data-vocabify-level')).toBe('3');
  });

  it('does not touch editable fields, code or scripts', async () => {
    document.body.innerHTML = `
      <textarea>one</textarea>
      <input value="one">
      <div contenteditable="true"><p>one</p></div>
      <div contenteditable="false">one</div>
      <pre><code>one</code></pre>
      <script>var one = 1;</script>
      <style>.one {}</style>
      <svg><text>one</text></svg>`;
    await replaceTextNodes(document.body);
    expect(spans()).toHaveLength(1);
    expect(spans()[0].parentElement?.getAttribute('contenteditable')).toBe('false');
    expect(document.querySelector('textarea')?.value).toBe('one');
    expect(document.querySelector('script')?.textContent).toBe('var one = 1;');
  });

  it('does not process its own spans twice', async () => {
    document.body.innerHTML = '<p>one</p>';
    await replaceTextNodes(document.body);
    await replaceTextNodes(document.body);
    expect(spans()).toHaveLength(1);
    expect(document.body.textContent).toBe('一');
  });

  it('updates and removes existing spans when the vocabulary changes', async () => {
    document.body.innerHTML = '<p>one person</p>';
    await replaceTextNodes(document.body);
    setVocab({ one: { subjectId: 9, characters: '壱', subjectType: 'vocabulary', srsStage: 1, level: 2 } }, true);
    await replaceTextNodes(document.body, true);
    expect(document.body.textContent).toBe('壱 person');
    expect(spans()[0].classList.contains('vocabify-vocabulary')).toBe(true);
    expect(spans()[0].classList.contains('vocabify-kanji')).toBe(false);
  });
});

describe('reverseVocabify and restyle', () => {
  it('restores the original text', async () => {
    document.body.innerHTML = '<p>One person</p>';
    await replaceTextNodes(document.body);
    reverseVocabify();
    expect(spans()).toHaveLength(0);
    expect(document.body.textContent).toBe('One person');
  });

  it('switches between styled and unstyled classes', async () => {
    document.body.innerHTML = '<p>one</p>';
    await replaceTextNodes(document.body);
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
    await flushPending();
    expect(document.body.textContent).toBe('人一');
  });

  it('ignores the changes it makes itself', async () => {
    document.body.innerHTML = '';
    startObserving(document.body);
    document.body.append('one');
    await Promise.resolve();
    await flushPending();
    await Promise.resolve();
    await flushPending();
    expect(spans()).toHaveLength(1);
  });
});

describe('word sense', () => {
  it('uses the first translation without a model', async () => {
    document.body.innerHTML = '<p>Hint or Tip: press the button.</p>';
    await replaceTextNodes(document.body);
    expect(document.body.textContent).toBe('Hint or 先: press the button.');
  });

  it('keeps the English word when the part of speech does not fit', async () => {
    document.body.innerHTML = '<p>Do you tip the waiter?</p>';
    await replaceTextNodes(document.body);
    expect(spans()).toHaveLength(0);
  });

  it('shows the English word until the model answers, then its choice', async () => {
    const requests: SenseRequest[] = [];
    let answer: (ids: (number | null)[]) => void = () => {};
    setSenseResolver(batch => {
      requests.push(...batch);
      return new Promise(resolve => (answer = resolve));
    });
    document.body.innerHTML = '<p>One hint. Hint or Tip: press the button.</p><p>It is the tip of the iceberg.</p>';
    await replaceTextNodes(document.body);

    expect(document.body.textContent).toBe('一 hint. Hint or Tip: press the button.It is the tip of the iceberg.');
    expect(
      requests.map(r => [r.sentence, r.sentence.slice(r.start, r.start + 3), r.candidates.map(c => c.subjectId)]),
    ).toEqual([
      ['Hint or Tip: press the button.', 'Tip', [4, 5]],
      ['It is the tip of the iceberg.', 'tip', [4, 5]],
    ]);
    expect(requests[0].candidates[1].texts).toEqual(['Hint, Tip', 'Give me a hint.']);

    answer([5, null]);
    await settle();
    expect(document.body.textContent).toBe('一 hint. Hint or ヒント: press the button.It is the tip of the iceberg.');
    expect(document.querySelectorAll('.vocabify-pending')).toHaveLength(0);
    expect(spans().map(s => s.title)).toEqual(['One', 'Tip']);
  });

  it('uses the first translation when the model fails', async () => {
    setSenseResolver(() => Promise.reject(new Error('no model')));
    const warn = console.warn;
    console.warn = () => {};
    document.body.innerHTML = '<p>It is the tip of the iceberg.</p>';
    await replaceTextNodes(document.body);
    await settle();
    console.warn = warn;
    expect(document.body.textContent).toBe('It is the 先 of the iceberg.');
  });

  it('keeps the chosen translation when the vocabulary is refreshed', async () => {
    setSenseResolver(async batch => batch.map(() => 5));
    document.body.innerHTML = '<p>Hint or Tip: press the button.</p>';
    await replaceTextNodes(document.body);
    await settle();
    setVocab(lookup, true);
    await replaceTextNodes(document.body, true);
    expect(document.body.textContent).toBe('Hint or ヒント: press the button.');
  });
});
