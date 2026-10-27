/**
 * Routes word-sense requests from content scripts to the page that runs the
 * model (pages/offscreen). On Chrome that page is an offscreen document; on
 * Firefox the background page has a DOM, so the page runs in a hidden iframe.
 */

const MODEL_PAGE = 'offscreen/index.html';
const OFFSCREEN_TARGET = 'vocabify-offscreen';
export const WORD_SENSE_MESSAGE = 'vocabify/word-sense';

let modelPage: Promise<void> | null = null;

async function openModelPage(): Promise<void> {
  if (chrome.offscreen) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    });
    if (contexts.length > 0) return;
    await chrome.offscreen.createDocument({
      url: MODEL_PAGE,
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification: 'Runs a small local language model that selects the translation that fits a sentence.',
    });
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const iframe = document.createElement('iframe');
    iframe.src = chrome.runtime.getURL(MODEL_PAGE);
    iframe.addEventListener('load', () => resolve(), { once: true });
    iframe.addEventListener('error', () => reject(new Error('The model page did not load')), { once: true });
    document.body.appendChild(iframe);
  });
}

function ensureModelPage(): Promise<void> {
  modelPage ??= openModelPage().catch(error => {
    modelPage = null;
    throw error;
  });
  return modelPage;
}

export function listenForWordSenseRequests() {
  chrome.runtime.onMessage.addListener((message: { type?: string; requests?: unknown[] }, _sender, sendResponse) => {
    if (message?.type !== WORD_SENSE_MESSAGE) return false;
    ensureModelPage()
      .then(() =>
        chrome.runtime.sendMessage({ target: OFFSCREEN_TARGET, type: 'word-sense', requests: message.requests }),
      )
      .then(sendResponse, (error: unknown) => sendResponse({ ok: false, error: String(error) }));
    return true;
  });
}
