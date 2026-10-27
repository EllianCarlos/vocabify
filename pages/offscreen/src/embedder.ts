import type * as Ort from 'onnxruntime-web/wasm';
import type { WordPieceTokenizer } from './tokenizer';

type OrtModule = typeof Ort;

const BATCH_SIZE = 16;

/**
 * Sentence embeddings with all-MiniLM-L6-v2: mean pooling over the token
 * embeddings (ignoring padding), then L2 normalisation. This is the same
 * method as sentence-transformers, so cosine similarity is a dot product.
 */
export class Embedder {
  private readonly cache = new Map<string, Float32Array>();

  constructor(
    private readonly ort: OrtModule,
    private readonly session: Ort.InferenceSession,
    private readonly tokenizer: WordPieceTokenizer,
    private readonly maxCacheSize = 5000,
  ) {}

  async embed(texts: string[]): Promise<Float32Array[]> {
    const missing = [...new Set(texts.filter(text => !this.cache.has(text)))];
    for (let i = 0; i < missing.length; i += BATCH_SIZE) {
      const batch = missing.slice(i, i + BATCH_SIZE);
      const vectors = await this.run(batch);
      batch.forEach((text, j) => this.remember(text, vectors[j]));
    }
    return texts.map(text => this.cache.get(text)!);
  }

  private remember(text: string, vector: Float32Array) {
    if (this.cache.size >= this.maxCacheSize) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(text, vector);
  }

  private async run(texts: string[]): Promise<Float32Array[]> {
    const encoded = texts.map(text => this.tokenizer.encode(text).ids);
    const length = Math.max(...encoded.map(ids => ids.length));
    const size = texts.length * length;
    const inputIds = new BigInt64Array(size).fill(BigInt(this.tokenizer.padId));
    const attentionMask = new BigInt64Array(size);
    const tokenTypeIds = new BigInt64Array(size);
    encoded.forEach((ids, row) => {
      ids.forEach((id, col) => {
        inputIds[row * length + col] = BigInt(id);
        attentionMask[row * length + col] = 1n;
      });
    });
    const shape = [texts.length, length];
    const feeds: Record<string, Ort.Tensor> = {
      input_ids: new this.ort.Tensor('int64', inputIds, shape),
      attention_mask: new this.ort.Tensor('int64', attentionMask, shape),
      token_type_ids: new this.ort.Tensor('int64', tokenTypeIds, shape),
    };
    for (const name of Object.keys(feeds)) if (!this.session.inputNames.includes(name)) delete feeds[name];

    const output = await this.session.run(feeds);
    const hidden = output.last_hidden_state ?? output[this.session.outputNames[0]];
    const [, tokens, dims] = hidden.dims as number[];
    const data = hidden.data as Float32Array;

    return encoded.map((ids, row) => {
      const vector = new Float32Array(dims);
      for (let t = 0; t < ids.length; t++) {
        const offset = (row * tokens + t) * dims;
        for (let d = 0; d < dims; d++) vector[d] += data[offset + d];
      }
      let norm = 0;
      for (let d = 0; d < dims; d++) {
        vector[d] /= ids.length;
        norm += vector[d] * vector[d];
      }
      norm = Math.sqrt(norm) || 1;
      for (let d = 0; d < dims; d++) vector[d] /= norm;
      return vector;
    });
  }
}
