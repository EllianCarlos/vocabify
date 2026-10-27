/**
 * Downloads the word-sense model once, checks it, and keeps it in the
 * extension's Cache Storage.
 *
 * Model: Xenova/all-MiniLM-L6-v2 (Apache-2.0), quantized ONNX build, 23 MB.
 * The SHA-256 values protect against a changed or damaged download.
 */

const BASE_URL = 'https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/';
const CACHE_NAME = 'vocabify-word-sense-model-v1';

export const MODEL_FILES = {
  model: {
    path: 'onnx/model_quantized.onnx',
    sha256: 'afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1',
  },
  tokenizer: {
    path: 'tokenizer.json',
    sha256: 'da0e79933b9ed51798a3ae27893d3c5fa4a201126cef75586296df9b4d2c62a0',
  },
} as const;

export async function sha256(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Returns the file from the cache, or downloads it. Throws if the hash is wrong. */
export async function loadModelFile(file: { path: string; sha256: string }): Promise<ArrayBuffer> {
  const url = BASE_URL + file.path;
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(url);
  if (cached) {
    const data = await cached.arrayBuffer();
    if ((await sha256(data)) === file.sha256) return data;
    await cache.delete(url);
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download of ${file.path} failed: HTTP ${response.status}`);
  const data = await response.arrayBuffer();
  const hash = await sha256(data);
  if (hash !== file.sha256) throw new Error(`${file.path} has an unexpected SHA-256 (${hash}); not used`);
  await cache.put(url, new Response(data));
  return data;
}
