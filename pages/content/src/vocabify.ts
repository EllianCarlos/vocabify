import type { SimplifiedVocab, VocabEntry, VocabLookup } from '@extension/storage';
import { readBlockText, type BlockText, sentenceAt } from './context';
import { blockOf, isEnglishBlock } from './language';
import { type Match, normalizeKey, PhraseMatcher } from './matcher';
import { candidatesOf, type Decision, decide, type SenseContext } from './sense';

/**
 * DOM side of Vocabify. This module has no runtime dependency on extension
 * storage or messaging, so it can be unit tested in a plain DOM environment.
 *
 * A pass over the page has two steps:
 *  1. Analysis (read only, can be async): find matches, check the language of
 *     each block, and decide for each match which translation fits.
 *  2. Change (synchronous): replace the text.
 */

const SPAN_CLASS = 'vocabify';
const PENDING_CLASS = 'vocabify-pending';
const SUBJECT_TYPE_ATTR = 'data-vocabify-subject-type';
const SUBJECT_ID_ATTR = 'data-vocabify-subject-id';

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

/** A request to the word-sense model (option B). */
export interface SenseRequest {
  /** The sentence around the word, with original English words. */
  sentence: string;
  /** Where the word starts in `sentence`. */
  start: number;
  /** The word as it appears on the page. */
  word: string;
  candidates: { subjectId: number; texts: string[] }[];
}

/** Returns, for each request, the chosen subject id, or null to keep the English word. */
export type SenseResolver = (requests: SenseRequest[]) => Promise<(number | null)[]>;

interface State {
  matcher: PhraseMatcher;
  lookup: Map<string, VocabEntry>;
  styled: boolean;
}

let state: State = { matcher: new PhraseMatcher([]), lookup: new Map(), styled: true };
let senseResolver: SenseResolver | null = null;

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
  const normalized = new Map<string, VocabEntry>();
  for (const [meaning, vocab] of Object.entries(lookup)) {
    normalized.set(normalizeKey(meaning), vocab);
  }
  state = { matcher: new PhraseMatcher(normalized.keys()), lookup: normalized, styled };
}

export function hasVocab(): boolean {
  return state.matcher.size > 0;
}

/** Sets the word-sense model client. With null, the first fitting translation is used. */
export function setSenseResolver(resolver: SenseResolver | null) {
  senseResolver = resolver;
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
  span.classList.remove(PENDING_CLASS);
  const [styled, plain] = styleClasses(vocab.subjectType);
  span.classList.add(state.styled ? styled : plain);
  span.setAttribute(SUBJECT_TYPE_ATTR, vocab.subjectType);
  span.setAttribute(SUBJECT_ID_ATTR, String(vocab.subjectId));
  span.setAttribute('data-vocabify', vocab.characters);
  span.setAttribute('data-vocabify-level', String(vocab.level));
  if (span.textContent !== vocab.characters) span.textContent = vocab.characters;
}

function createSpan(original: string): HTMLElement {
  const span = document.createElement('span');
  span.classList.add(SPAN_CLASS);
  // The title keeps the original text and shows it as a tooltip.
  span.title = original;
  return span;
}

function unwrap(span: HTMLElement) {
  span.replaceWith(document.createTextNode(span.title));
}

/** Updates an existing span after the vocabulary changed. */
function refreshSpan(span: HTMLElement) {
  if (span.classList.contains(PENDING_CLASS)) return;
  const entry = state.lookup.get(normalizeKey(span.title));
  if (entry === undefined) {
    unwrap(span);
    return;
  }
  // Keep the translation that was chosen for this place, if it still exists.
  const id = Number(span.getAttribute(SUBJECT_ID_ATTR));
  const candidates = candidatesOf(entry);
  applyVocab(span, candidates.find(candidate => candidate.subjectId === id) ?? candidates[0]);
}

// ---------------------------------------------------------------------------
// Word-sense model requests
// ---------------------------------------------------------------------------

interface QueuedRequest {
  request: SenseRequest;
  span: HTMLElement;
  candidates: SimplifiedVocab[];
}

let queue: QueuedRequest[] = [];

function senseTexts(vocab: SimplifiedVocab): string[] {
  const texts = [...(vocab.contextSentences ?? [])];
  if (vocab.meanings?.length) texts.unshift(vocab.meanings.join(', '));
  return texts;
}

async function sendQueue() {
  const batch = queue;
  queue = [];
  if (batch.length === 0) return;
  const startEpoch = epoch;
  let results: (number | null)[];
  try {
    results = senseResolver ? await senseResolver(batch.map(item => item.request)) : [];
  } catch (error) {
    console.warn('Vocabify: the word-sense model is not available, so the first translation is used.', error);
    results = batch.map(item => item.candidates[0].subjectId);
  }
  if (epoch !== startEpoch) return;
  batch.forEach((item, i) => {
    if (!item.span.isConnected || !item.span.classList.contains(PENDING_CLASS)) return;
    const choice = item.candidates.find(candidate => candidate.subjectId === results[i]);
    if (choice) applyVocab(item.span, choice);
    else unwrap(item.span);
  });
  observer?.takeRecords();
}

// ---------------------------------------------------------------------------
// Replacement
// ---------------------------------------------------------------------------

interface PlannedMatch {
  match: Match;
  decision: Decision;
  context: SenseContext | null;
}

function replaceInTextNode(node: Text, planned: PlannedMatch[]) {
  const text = node.data;
  const fragment = document.createDocumentFragment();
  let last = 0;
  for (const { match, decision, context } of planned) {
    if (decision.kind === 'skip') continue;
    if (match.start > last) fragment.appendChild(document.createTextNode(text.slice(last, match.start)));
    const span = createSpan(match.text);
    if (decision.kind === 'replace') {
      applyVocab(span, decision.vocab);
    } else {
      // Show the English word until the model answers.
      span.classList.add(PENDING_CLASS);
      span.textContent = match.text;
      queue.push({
        span,
        candidates: decision.candidates,
        request: {
          sentence: context?.sentence ?? match.text,
          start: context?.start ?? 0,
          word: match.text,
          candidates: decision.candidates.map(vocab => ({ subjectId: vocab.subjectId, texts: senseTexts(vocab) })),
        },
      });
    }
    fragment.appendChild(span);
    last = match.end;
  }
  if (last === 0) return;
  if (last < text.length) fragment.appendChild(document.createTextNode(text.slice(last)));
  node.replaceWith(fragment);
}

function planMatches(text: Text, matches: Match[], blockText: BlockText | null): PlannedMatch[] {
  const base = blockText?.offsets.get(text);
  return matches.flatMap(match => {
    const entry = state.lookup.get(match.key);
    if (entry === undefined) return [];
    const context = blockText && base !== undefined ? sentenceAt(blockText.text, base + match.start) : null;
    return [{ match, context, decision: decide(entry, match.key, context, senseResolver !== null) }];
  });
}

/**
 * Replaces vocabulary in all text below `root`. When `refreshExisting` is
 * true, spans that are already present are updated for the current vocab.
 *
 * Text is replaced only in blocks that are English (see language.ts). All
 * checks finish before the DOM is changed, so the changes happen in one
 * synchronous step.
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

  // 1. Analysis. Only text that contains a match needs more work.
  const found = new Map<Text, { data: string; matches: Match[] }>();
  if (hasVocab()) {
    for (const text of texts) {
      const matches = state.matcher.findAll(text.data);
      if (matches.length > 0) found.set(text, { data: text.data, matches });
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

  const blockTexts = new Map<Element, BlockText>();
  const plans = new Map<Text, PlannedMatch[]>();
  for (const [text, { data, matches }] of found) {
    const block = blocks.get(text);
    if (!block || !english.get(block) || !text.isConnected || text.data !== data) continue;
    let blockText = blockTexts.get(block);
    if (blockText === undefined) {
      blockText = readBlockText(block);
      blockTexts.set(block, blockText);
    }
    plans.set(text, planMatches(text, matches, blockText));
  }

  // 2. Change the DOM.
  if (refreshExisting) spans.filter(span => span.isConnected).forEach(refreshSpan);
  for (const [text, planned] of plans) {
    if (!isInsideSkipped(text)) replaceInTextNode(text, planned);
  }
  if (queue.length > 0) void sendQueue();
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
  queue = [];
}

/** Runs pending work now. Used by tests. */
export function flushPending(): Promise<void> {
  return flush();
}

/** Waits until the model requests of the current pass are answered. Used by tests. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve, 0));
}

/** Drops mutation records that our own synchronous changes created. */
export function discardOwnRecords() {
  observer?.takeRecords();
}
