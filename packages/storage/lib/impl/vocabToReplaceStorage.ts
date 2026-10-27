import { StorageEnum } from '../base/enums.js';
import { createStorage } from '../base/base.js';
import type { SubjectType } from '@extension/shared';

export interface SimplifiedVocab {
  subjectId: number;
  characters: string;
  subjectType: SubjectType;
  srsStage: number;
  level: number;
  /** WaniKani parts of speech, for example "noun" or "godan verb" (vocabulary only). */
  partsOfSpeech?: string[];
  /** All English meanings. Kept only when the English key has alternatives. */
  meanings?: string[];
  /** English context sentences. Kept only when the English key has alternatives. */
  contextSentences?: string[];
}

/**
 * The subjects for one English key. The entry itself is the default choice;
 * `alternatives` holds other subjects (with different characters) that have
 * the same English meaning, so the content script can select by context.
 */
export interface VocabEntry extends SimplifiedVocab {
  alternatives?: SimplifiedVocab[];
}

export interface VocabLookup {
  [key: string]: VocabEntry;
}

export interface VocabLookupAndRegex {
  /** @deprecated No longer used; the content script matches words without a regex. */
  regexString?: string;
  lookup: VocabLookup;
}

export const vocabToReplaceStorage = createStorage<VocabLookupAndRegex>(
  'vocab-to-replace-storage-key',
  { lookup: {} },
  {
    storageEnum: StorageEnum.Local,
    liveUpdate: true,
  },
);
