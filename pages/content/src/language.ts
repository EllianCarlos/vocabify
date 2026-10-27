/**
 * Decides if text is English, so that Vocabify does not replace words in
 * other languages (for example "do" in the Portuguese "Feira do bairro").
 *
 * The decision for a text block uses, in this order:
 *  1. The nearest `lang` attribute, when it names a language other than English.
 *  2. Language detection on the block text, when the text is long enough and
 *     the result is reliable.
 *  3. The language of the whole page (its `lang` attribute and a detection on
 *     a sample of its text).
 */

export interface DetectedLanguage {
  language: string;
  percentage: number;
}

export interface DetectionResult {
  isReliable: boolean;
  languages: DetectedLanguage[];
}

export type LanguageDetector = (text: string) => Promise<DetectionResult>;

/** Shorter text gives unreliable detection results. */
const MIN_DETECT_LETTERS = 40;
const MAX_DETECT_CHARS = 1500;
const PAGE_SAMPLE_CHARS = 5000;

const BLOCK_SELECTOR = [
  'p',
  'li',
  'dd',
  'dt',
  'td',
  'th',
  'caption',
  'figcaption',
  'blockquote',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'summary',
  'label',
  'article',
  'section',
  'aside',
  'header',
  'footer',
  'nav',
  'main',
  'div',
].join(',');

const SAMPLE_SKIP = new Set(['script', 'style', 'noscript', 'template', 'textarea', 'code', 'pre', 'svg']);

let detector: LanguageDetector | null = null;
let blockCache = new WeakMap<Element, Promise<boolean>>();
let pageCache: Promise<boolean> | null = null;

/** Sets the detector. Without one, only `lang` attributes are used. */
export function setLanguageDetector(newDetector: LanguageDetector | null) {
  detector = newDetector;
  resetLanguageCache();
}

export function resetLanguageCache() {
  blockCache = new WeakMap();
  pageCache = null;
}

function isEnglishTag(tag: string): boolean {
  return /^en(-|$)/i.test(tag.trim());
}

function letterCount(text: string): number {
  return text.match(/\p{L}/gu)?.length ?? 0;
}

/** Returns true/false when detection is reliable, or null when it is not. */
async function detect(text: string): Promise<boolean | null> {
  if (detector === null || letterCount(text) < MIN_DETECT_LETTERS) return null;
  try {
    const result = await detector(text.slice(0, MAX_DETECT_CHARS));
    const top = result.languages[0];
    if (!result.isReliable || top === undefined) return null;
    return isEnglishTag(top.language);
  } catch {
    return null;
  }
}

function pageSample(doc: Document): string {
  if (doc.body === null) return '';
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        return SAMPLE_SKIP.has((node as Element).localName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let sample = '';
  for (let node = walker.nextNode(); node !== null && sample.length < PAGE_SAMPLE_CHARS; node = walker.nextNode()) {
    const text = (node as Text).data.trim();
    if (text) sample += text + ' ';
  }
  return sample;
}

async function computePageIsEnglish(doc: Document): Promise<boolean> {
  const htmlLang = doc.documentElement.getAttribute('lang');
  const detected = await detect(pageSample(doc));
  if (detected !== null) return detected;
  // Without a reliable detection, trust the page's own declaration.
  return htmlLang === null || htmlLang.trim() === '' || isEnglishTag(htmlLang);
}

function pageIsEnglish(doc: Document): Promise<boolean> {
  pageCache ??= computePageIsEnglish(doc);
  return pageCache;
}

async function computeBlockIsEnglish(block: Element): Promise<boolean> {
  const langElement = block.closest('[lang]');
  const lang = langElement?.getAttribute('lang') ?? '';
  // An explicit lang on the block or a parent (not only on <html>) is a strong signal.
  if (lang.trim() !== '' && langElement !== block.ownerDocument.documentElement && !isEnglishTag(lang)) return false;
  const detected = await detect(block.textContent ?? '');
  if (detected !== null) return detected;
  return pageIsEnglish(block.ownerDocument);
}

/** The element whose text is used to decide the language of `node`. */
export function blockOf(node: Node): Element | null {
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return element?.closest(BLOCK_SELECTOR) ?? element?.ownerDocument.body ?? null;
}

/** Returns true if the text of `block` is English. The result is cached. */
export function isEnglishBlock(block: Element): Promise<boolean> {
  let result = blockCache.get(block);
  if (result === undefined) {
    result = computeBlockIsEnglish(block);
    blockCache.set(block, result);
  }
  return result;
}
