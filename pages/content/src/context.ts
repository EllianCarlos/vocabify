import type { SenseContext } from './sense';

/**
 * Builds the English text of a block and finds the sentence around a match.
 * Words that Vocabify already replaced count as their original English text
 * (from the span title), so the sentence stays readable for the tagger and
 * the model.
 */

const SKIP = new Set(['script', 'style', 'noscript', 'template', 'textarea', 'svg', 'math', 'iframe', 'canvas']);
const MAX_SENTENCE = 300;

export interface BlockText {
  text: string;
  /** Where each text node starts in `text`. */
  offsets: Map<Text, number>;
}

export function readBlockText(block: Element): BlockText {
  const offsets = new Map<Text, number>();
  let text = '';
  const walker = block.ownerDocument.createTreeWalker(block, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
      const element = node as Element;
      if (SKIP.has(element.localName)) return NodeFilter.FILTER_REJECT;
      if (element.classList.contains('vocabify')) {
        text += (element as HTMLElement).title;
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_SKIP;
    },
  });
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    offsets.set(node as Text, text.length);
    text += (node as Text).data;
  }
  return { text, offsets };
}

const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('en', { granularity: 'sentence' }) : null;

/** Returns the sentence of `text` that contains `position`, shortened if needed. */
export function sentenceAt(text: string, position: number): SenseContext {
  let start = 0;
  let end = text.length;
  if (segmenter !== null) {
    for (const segment of segmenter.segment(text)) {
      if (segment.index <= position && position < segment.index + segment.segment.length) {
        start = segment.index;
        end = segment.index + segment.segment.length;
        break;
      }
    }
  }
  // Keep at most MAX_SENTENCE characters, centred on the match.
  if (end - start > MAX_SENTENCE) {
    start = Math.max(start, position - MAX_SENTENCE / 2);
    end = Math.min(end, start + MAX_SENTENCE);
  }
  const raw = text.slice(start, end);
  const leading = raw.length - raw.trimStart().length;
  return { sentence: raw.trim(), start: position - start - leading };
}
