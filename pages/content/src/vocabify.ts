import type { SimplifiedVocab, VocabLookup } from '@extension/storage';
import { blockOf, isEnglishBlock } from './language';
import { type Match, normalizeKey, PhraseMatcher } from './matcher';

/**
 * DOM side of Vocabify. This module has no runtime dependency on extension
 * storage, so it can be unit tested in a plain DOM environment.
 */

const SPAN_CLASS = 'vocabify';
const SUBJECT_TYPE_ATTR = 'data-vocabify-subject-type';

/** Never change text inside these elements (or inside editable content). */
const SKIP_TAGS = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'textarea',
  'input',
  'select',
  'option',
  'code',
  'pre',
  'kbd',
  'samp',
  'svg',
  'math',
  'iframe',
  'canvas',
  'title',
  'head',
]);
const SKIP_SELECTOR = [...SKIP_TAGS, '[contenteditable]:not([contenteditable="false"])'].join(',');

const OBSERVER_OPTIONS: MutationObserverInit = { childList: true, subtree: true, characterData: true };

interface State {
  matcher: PhraseMatcher;
  lookup: Map<string, SimplifiedVocab>;
  styled: boolean;
}

let state: State = { matcher: new PhraseMatcher([]), lookup: new Map(), styled: true };

let observer: MutationObserver | null = null;
const pending = new Set<Node>();
let flushScheduled = false;
/** Changes when Vocabify is stopped, so unfinished async work is dropped. */
let epoch = 0;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Sets the vocabulary to show. Keys are English meanings. */
export function setVocab(lookup: VocabLookup, styled: boolean) {
  const normalized = new Map<string, SimplifiedVocab>();
  for (const [meaning, vocab] of Object.entries(lookup)) {
    normalized.set(normalizeKey(meaning), vocab);
  }
  state = { matcher: new PhraseMatcher(normalized.keys()), lookup: normalized, styled };
}

export function hasVocab(): boolean {
  return state.matcher.size > 0;
}

// ---------------------------------------------------------------------------
// Element helpers
// ---------------------------------------------------------------------------

function isSkippedElement(element: Element): boolean {
  if (SKIP_TAGS.has(element.localName)) return true;
  const editable = element.getAttribute('contenteditable');
  return editable !== null && editable !== 'false';
}

function isInsideSkipped(node: Node): boolean {
  if (node.ownerDocument?.designMode === 'on') return true;
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  if (element === null) return node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE;
  return element.closest(SKIP_SELECTOR) !== null;
}

function isVocabSpan(node: Node | null): node is HTMLElement {
  return node !== null && node.nodeType === Node.ELEMENT_NODE && (node as Element).classList.contains(SPAN_CLASS);
}

function styleClasses(subjectType: string): [styled: string, plain: string] {
  const styled = `${SPAN_CLASS}-${subjectType}`;
  return [styled, `${styled}-no-style`];
}

function applyVocab(span: HTMLElement, vocab: SimplifiedVocab) {
  const oldType = span.getAttribute(SUBJECT_TYPE_ATTR);
  if (oldType !== null) span.classList.remove(...styleClasses(oldType));
  const [styled, plain] = styleClasses(vocab.subjectType);
  span.classList.add(state.styled ? styled : plain);
  span.setAttribute(SUBJECT_TYPE_ATTR, vocab.subjectType);
  span.setAttribute('data-vocabify', vocab.characters);
  span.setAttribute('data-vocabify-level', String(vocab.level));
  if (span.textContent !== vocab.characters) span.textContent = vocab.characters;
}

function createSpan(original: string, vocab: SimplifiedVocab): HTMLElement {
  const span = document.createElement('span');
  span.classList.add(SPAN_CLASS);
  // The title keeps the original text and shows it as a tooltip.
  span.title = original;
  span.lang = 'ja';
  applyVocab(span, vocab);
  return span;
}

function unwrap(span: HTMLElement) {
  span.replaceWith(document.createTextNode(span.title));
}

/** Updates an existing span after the vocabulary changed. */
function refreshSpan(span: HTMLElement) {
  const vocab = state.lookup.get(normalizeKey(span.title));
  if (vocab === undefined) unwrap(span);
  else applyVocab(span, vocab);
}

function replaceInTextNode(node: Text, known?: { text: string; matches: Match[] }) {
  const text = node.data;
  const matches = known?.text === text ? known.matches : state.matcher.findAll(text);
  if (matches.length === 0) return;
  const fragment = document.createDocumentFragment();
  let last = 0;
  for (const match of matches) {
    const vocab = state.lookup.get(match.key);
    if (vocab === undefined) continue;
    if (match.start > last) fragment.appendChild(document.createTextNode(text.slice(last, match.start)));
    fragment.appendChild(createSpan(match.text, vocab));
    last = match.end;
  }
  if (last === 0) return;
  if (last < text.length) fragment.appendChild(document.createTextNode(text.slice(last)));
  node.replaceWith(fragment);
}

// ---------------------------------------------------------------------------
// Tree walking
// ---------------------------------------------------------------------------

/**
 * Replaces vocabulary in all text below `root`. When `refreshExisting` is
 * true, spans that are already present are updated for the current vocab.
 *
 * Text is replaced only in blocks that are English (see language.ts). All
 * language checks finish before the DOM is changed, so the changes happen in
 * one synchronous step.
 */
export async function replaceTextNodes(root: Node, refreshExisting = false): Promise<void> {
  if (isInsideSkipped(root)) return;
  const startEpoch = epoch;
  const texts: Text[] = [];
  const spans: HTMLElement[] = [];

  if (root.nodeType === Node.TEXT_NODE) {
    if (isVocabSpan(root.parentElement)) spans.push(root.parentElement);
    else texts.push(root as Text);
  } else if (isVocabSpan(root)) {
    spans.push(root);
  } else if (root.nodeType === Node.ELEMENT_NODE || root.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (node.nodeType === Node.TEXT_NODE) {
          // Skip whitespace-only nodes quickly.
          return /\S/.test((node as Text).data) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }
        const element = node as Element;
        if (element.classList.contains(SPAN_CLASS)) {
          spans.push(element as HTMLElement);
          return NodeFilter.FILTER_REJECT;
        }
        return isSkippedElement(element) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
      },
    });
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) texts.push(node as Text);
  }

  // Only text that contains a match needs a language check.
  const found = new Map<Text, { text: string; matches: Match[] }>();
  if (hasVocab()) {
    for (const text of texts) {
      const matches = state.matcher.findAll(text.data);
      if (matches.length > 0) found.set(text, { text: text.data, matches });
    }
  }
  const blocks = new Map<Text, Element | null>([...found.keys()].map(text => [text, blockOf(text)]));
  const english = new Map<Element, boolean>();
  await Promise.all(
    [...new Set(blocks.values())].map(async block => {
      if (block !== null) english.set(block, await isEnglishBlock(block));
    }),
  );

  if (epoch !== startEpoch) return;
  if (refreshExisting) spans.filter(span => span.isConnected).forEach(refreshSpan);
  for (const [text, known] of found) {
    const block = blocks.get(text);
    if (block && english.get(block) && text.isConnected && !isInsideSkipped(text)) replaceInTextNode(text, known);
  }
}

/** Removes every Vocabify span below `root` and restores the original text. */
export function reverseVocabify(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>(`.${SPAN_CLASS}`).forEach(unwrap);
}

/** Applies the style preference to every span. */
export function restyle(styled: boolean, root: ParentNode = document) {
  state = { ...state, styled };
  root.querySelectorAll<HTMLElement>(`.${SPAN_CLASS}`).forEach(span => {
    const subjectType = span.getAttribute(SUBJECT_TYPE_ATTR);
    if (subjectType === null) return;
    const [styledClass, plainClass] = styleClasses(subjectType);
    span.classList.toggle(styledClass, styled);
    span.classList.toggle(plainClass, !styled);
  });
}

// ---------------------------------------------------------------------------
// Live updates
// ---------------------------------------------------------------------------

function collect(records: MutationRecord[]) {
  for (const record of records) {
    if (record.type === 'characterData') pending.add(record.target);
    else record.addedNodes.forEach(node => pending.add(node));
  }
}

async function flush() {
  flushScheduled = false;
  if (observer === null) return;
  collect(observer.takeRecords());
  const nodes = [...pending].filter(node => node.isConnected);
  pending.clear();
  await Promise.all(nodes.map(node => replaceTextNodes(node)));
  // Drop the records that our own changes created.
  observer?.takeRecords();
}

function scheduleFlush() {
  if (flushScheduled) return;
  flushScheduled = true;
  const run = () => void flush();
  if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 200 });
  else setTimeout(run, 50);
}

/** Starts watching `root` for new text. Changes are batched. */
export function startObserving(root: Node = document.body) {
  if (observer === null) {
    observer = new MutationObserver(records => {
      collect(records);
      if (pending.size > 0) scheduleFlush();
    });
  }
  observer.observe(root, OBSERVER_OPTIONS);
}

export function stopObserving() {
  epoch++;
  observer?.disconnect();
  observer = null;
  pending.clear();
}

/** Runs pending work now. Used by tests. */
export function flushPending(): Promise<void> {
  return flush();
}

/** Drops mutation records that our own synchronous changes created. */
export function discardOwnRecords() {
  observer?.takeRecords();
}
