/**
 * A small BERT WordPiece tokenizer (uncased), as used by all-MiniLM-L6-v2.
 * It reads the vocabulary from the model's tokenizer.json and gives the same
 * token ids as the HuggingFace BertTokenizer for normal text.
 */

export interface TokenizerJson {
  model: { vocab: Record<string, number>; unk_token?: string; max_input_chars_per_word?: number };
}

export interface Encoded {
  ids: number[];
}

const PUNCTUATION = /[\p{P}\p{S}]/u;

function isCjk(code: number): boolean {
  return (
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x20000 && code <= 0x2a6df) ||
    (code >= 0x2a700 && code <= 0x2b73f) ||
    (code >= 0x2b740 && code <= 0x2b81f) ||
    (code >= 0x2b820 && code <= 0x2ceaf) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0x2f800 && code <= 0x2fa1f)
  );
}

function isAsciiPunctuation(code: number): boolean {
  return (
    (code >= 33 && code <= 47) ||
    (code >= 58 && code <= 64) ||
    (code >= 91 && code <= 96) ||
    (code >= 123 && code <= 126)
  );
}

export class WordPieceTokenizer {
  private readonly vocab: Map<string, number>;
  private readonly unkId: number;
  readonly clsId: number;
  readonly sepId: number;
  readonly padId: number;
  private readonly maxCharsPerWord: number;

  constructor(json: TokenizerJson) {
    this.vocab = new Map(Object.entries(json.model.vocab));
    const id = (token: string) => {
      const value = this.vocab.get(token);
      if (value === undefined) throw new Error(`Token ${token} is missing from the vocabulary`);
      return value;
    };
    this.unkId = id(json.model.unk_token ?? '[UNK]');
    this.clsId = id('[CLS]');
    this.sepId = id('[SEP]');
    this.padId = id('[PAD]');
    this.maxCharsPerWord = json.model.max_input_chars_per_word ?? 100;
  }

  /** BertNormalizer + BertPreTokenizer: clean, lowercase, strip accents, split. */
  private basicTokens(text: string): string[] {
    let cleaned = '';
    for (const char of text) {
      const code = char.codePointAt(0)!;
      if (code === 0 || code === 0xfffd || /\p{Cc}/u.test(char)) {
        if (char === '\t' || char === '\n' || char === '\r') cleaned += ' ';
        continue;
      }
      cleaned += isCjk(code) ? ` ${char} ` : /\s/.test(char) ? ' ' : char;
    }
    cleaned = cleaned
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Mn}/gu, '');
    const tokens: string[] = [];
    for (const word of cleaned.split(' ')) {
      let current = '';
      for (const char of word) {
        if (isAsciiPunctuation(char.codePointAt(0)!) || PUNCTUATION.test(char)) {
          if (current) tokens.push(current);
          tokens.push(char);
          current = '';
        } else {
          current += char;
        }
      }
      if (current) tokens.push(current);
    }
    return tokens;
  }

  private wordPiece(word: string): number[] {
    const chars = [...word];
    if (chars.length > this.maxCharsPerWord) return [this.unkId];
    const ids: number[] = [];
    let start = 0;
    while (start < chars.length) {
      let end = chars.length;
      let found: number | undefined;
      while (start < end) {
        const piece = (start > 0 ? '##' : '') + chars.slice(start, end).join('');
        found = this.vocab.get(piece);
        if (found !== undefined) break;
        end--;
      }
      if (found === undefined) return [this.unkId];
      ids.push(found);
      start = end;
    }
    return ids;
  }

  /** Returns [CLS] tokens [SEP], with at most `maxLength` ids in total. */
  encode(text: string, maxLength = 128): Encoded {
    const ids = [this.clsId];
    for (const token of this.basicTokens(text)) {
      for (const id of this.wordPiece(token)) {
        if (ids.length >= maxLength - 1) break;
        ids.push(id);
      }
    }
    ids.push(this.sepId);
    return { ids };
  }
}
