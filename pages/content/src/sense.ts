import nlp from 'compromise/two';
import type { SimplifiedVocab, VocabEntry } from '@extension/storage';

/**
 * Word-sense rules (option A). They decide, for one match in a sentence,
 * which of the possible translations fit:
 *
 *  - The English word is tagged in its sentence (noun, verb, ...).
 *  - Translations whose WaniKani part of speech conflicts with the tag are
 *    removed: "tip" in "Do you tip the waiter?" is a verb, so the nouns
 *    先 and ヒント do not fit.
 *  - Function words ("do" in "Do you...", "so", "the") are not replaced by
 *    kanji or radicals, which have no part of speech.
 *  - Exact part-of-speech matches win over loose ones.
 *
 * If more than one translation is left, the caller can ask the model
 * (option B) or use the first one.
 */

export type EnglishPos = 'noun' | 'verb' | 'adjective' | 'adverb' | 'number' | 'pronoun' | 'function';

/** Loose groups: a noun-like English word can take a noun or adjective translation. */
const GROUP: Record<EnglishPos, string> = {
  noun: 'nominal',
  adjective: 'nominal',
  adverb: 'nominal',
  number: 'nominal',
  verb: 'verb',
  pronoun: 'pronoun',
  function: 'function',
};

const TAG_CACHE_SIZE = 200;
const tagCache = new Map<string, { start: number; end: number; pos: EnglishPos | null }[]>();

function toPos(tags: string[]): EnglishPos | null {
  const has = (tag: string) => tags.includes(tag);
  if (has('Pronoun')) return 'pronoun';
  if (has('Value')) return 'number';
  if (has('Determiner') || has('Preposition') || has('Conjunction') || has('Auxiliary') || has('Copula'))
    return 'function';
  if (has('Modal')) return 'function';
  if (has('Verb')) return 'verb';
  if (has('Adjective')) return 'adjective';
  if (has('Adverb')) return 'adverb';
  if (has('Noun')) return 'noun';
  return null;
}

function tagSentence(sentence: string) {
  let terms = tagCache.get(sentence);
  if (terms === undefined) {
    terms = [];
    for (const term of nlp(sentence).json({ offset: true }) as {
      terms: { text: string; tags: string[]; offset: { start: number; length: number } }[];
    }[]) {
      const list = term.terms;
      list.forEach((t, i) => {
        let pos = toPos(t.tags);
        // "do" is an auxiliary when a main verb follows: "Do you like it?", "I did not go".
        if (pos === 'verb' && /^(do|does|did)$/i.test(t.text)) {
          const question = t.tags.includes('QuestionWord');
          if (question || list.slice(i + 1, i + 4).some(next => toPos(next.tags) === 'verb')) pos = 'function';
        }
        terms!.push({ start: t.offset.start, end: t.offset.start + t.offset.length, pos });
      });
    }
    if (tagCache.size >= TAG_CACHE_SIZE) tagCache.delete(tagCache.keys().next().value!);
    tagCache.set(sentence, terms);
  }
  return terms;
}

/** Returns the part of speech of the word that starts at `start` in `sentence`. */
export function tagWordAt(sentence: string, start: number): EnglishPos | null {
  const term = tagSentence(sentence).find(t => t.start <= start && start < t.end);
  return term?.pos ?? null;
}

/** Maps WaniKani parts of speech to English ones. Returns null for "any". */
export function wanikaniPos(partsOfSpeech: string[] | undefined): Set<EnglishPos> | null {
  if (partsOfSpeech === undefined || partsOfSpeech.length === 0) return null;
  const result = new Set<EnglishPos>();
  for (const raw of partsOfSpeech) {
    const pos = raw.toLowerCase();
    if (/expression|prefix|suffix|conjunction|interjection|particle/.test(pos)) return null;
    if (pos.includes('pronoun')) result.add('pronoun');
    else if (pos.includes('adverb')) result.add('adverb');
    else if (pos.includes('verb')) {
      result.add('verb');
      if (pos.includes('suru') || pos.includes('する')) result.add('noun');
    } else if (pos.includes('adjective')) result.add('adjective');
    else if (pos.includes('numeral') || pos.includes('counter')) result.add('number').add('noun');
    else if (pos.includes('noun')) result.add('noun');
  }
  return result.size > 0 ? result : null;
}

/** 2 = exact match, 1 = loose match or unknown, 0 = conflict. */
export function posScore(vocab: SimplifiedVocab, pos: EnglishPos | null): number {
  if (pos === null) return 1;
  const classes = wanikaniPos(vocab.partsOfSpeech);
  if (classes === null) return pos === 'function' ? 0 : 1;
  if (classes.has(pos)) return 2;
  for (const c of classes) if (GROUP[c] === GROUP[pos]) return 1;
  return 0;
}

export function candidatesOf(entry: VocabEntry): SimplifiedVocab[] {
  const { alternatives, ...first } = entry;
  return [first, ...(alternatives ?? [])];
}

export type Decision =
  | { kind: 'replace'; vocab: SimplifiedVocab }
  | { kind: 'skip' }
  | { kind: 'ask'; candidates: SimplifiedVocab[] };

export interface SenseContext {
  /** The sentence that contains the match, with original English words. */
  sentence: string;
  /** Where the match starts in `sentence`. */
  start: number;
}

/**
 * Decides what to do with one match. `useModel` says if the caller can ask
 * the model when more than one translation is left.
 */
export function decide(entry: VocabEntry, matchKey: string, context: SenseContext | null, useModel: boolean): Decision {
  let candidates = candidatesOf(entry);
  // Part-of-speech rules apply to single words; phrases are specific enough.
  const singleWord = !/[ -]/.test(matchKey);
  if (singleWord && context !== null) {
    const pos = tagWordAt(context.sentence, context.start);
    const scored = candidates.map(vocab => ({ vocab, score: posScore(vocab, pos) })).filter(c => c.score > 0);
    const best = Math.max(0, ...scored.map(c => c.score));
    candidates = scored.filter(c => c.score === best).map(c => c.vocab);
  }
  if (candidates.length === 0) return { kind: 'skip' };
  if (candidates.length === 1 || !useModel || context === null) return { kind: 'replace', vocab: candidates[0] };
  return { kind: 'ask', candidates };
}
