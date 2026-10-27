import * as ort from 'onnxruntime-web/wasm';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import { classify, type SenseQuery } from './classifier';
import { Embedder } from './embedder';
import { loadModelFile, MODEL_FILES } from './model';
import { type TokenizerJson, WordPieceTokenizer } from './tokenizer';

/**
 * The page that runs the word-sense model. On Chrome it is an offscreen
 * document; on Firefox it is a hidden iframe in the background page. It
 * answers messages that the background script forwards from content scripts.
 */

export const OFFSCREEN_TARGET = 'vocabify-offscreen';

// The extension bundles the runtime; nothing is loaded from a CDN.
ort.env.wasm.wasmPaths = { wasm: wasmUrl };
// Threads need cross-origin isolation, which extension pages do not have.
ort.env.wasm.numThreads = 1;

let embedder: Promise<Embedder> | null = null;

function getEmbedder(): Promise<Embedder> {
  embedder ??= (async () => {
    const [model, tokenizer] = await Promise.all([
      loadModelFile(MODEL_FILES.model),
      loadModelFile(MODEL_FILES.tokenizer),
    ]);
    const session = await ort.InferenceSession.create(new Uint8Array(model), { executionProviders: ['wasm'] });
    const json = JSON.parse(new TextDecoder().decode(tokenizer)) as TokenizerJson;
    return new Embedder(ort, session, new WordPieceTokenizer(json));
  })().catch(error => {
    embedder = null;
    throw error;
  });
  return embedder;
}

interface SenseMessage {
  target: typeof OFFSCREEN_TARGET;
  type: 'word-sense';
  requests: SenseQuery[];
}

chrome.runtime.onMessage.addListener((message: SenseMessage, _sender, sendResponse) => {
  if (message?.target !== OFFSCREEN_TARGET || message.type !== 'word-sense') return false;
  getEmbedder()
    .then(model => classify(texts => model.embed(texts), message.requests))
    .then(
      choices => sendResponse({ ok: true, choices: choices.map(choice => choice.subjectId) }),
      (error: unknown) => sendResponse({ ok: false, error: String(error) }),
    );
  return true;
});
