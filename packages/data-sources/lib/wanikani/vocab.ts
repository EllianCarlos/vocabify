import {
  assignmentStorage,
  userStorage,
  radicalSubjectStorage,
  kanjiSubjectStorage,
  vocabularySubjectStorage,
  kanaVocabularySubjectStorage,
  waniKaniSubjectTypeSelectionStorage,
  wanikaniSrsRangeStorage,
  vocabToReplaceStorage,
} from '@extension/storage';
import type {
  AssignmentResponse,
  KanaVocabularyResponse,
  KanjiResponse,
  RadicalResponse,
  SubjectResponse,
  SubjectType,
  UserData,
  VocabularyResponse,
} from '@extension/shared';
import type { SimplifiedVocab, SubjectTypeSelection, SrsRange, SubjectIdMap, VocabLookup } from '@extension/storage';

/**
 * Helper function to get a subject from the appropriate lookup based on its type
 */
function getSubjectFromLookup(
  subjectId: number,
  subjectType: SubjectType,
  radicalLookup: SubjectIdMap<RadicalResponse>,
  kanjiLookup: SubjectIdMap<KanjiResponse>,
  vocabularyLookup: SubjectIdMap<VocabularyResponse>,
  kanaVocabularyLookup: SubjectIdMap<KanaVocabularyResponse>,
): SubjectResponse | undefined {
  switch (subjectType) {
    case 'radical':
      return radicalLookup[subjectId];
    case 'kanji':
      return kanjiLookup[subjectId];
    case 'vocabulary':
      return vocabularyLookup[subjectId];
    case 'kana_vocabulary':
      return kanaVocabularyLookup[subjectId];
  }
}

export function createAssignmentFilter(
  selectedSubjectType: SubjectTypeSelection,
  srsRange: SrsRange,
  user: UserData,
  radicalLookup: SubjectIdMap<RadicalResponse>,
  kanjiLookup: SubjectIdMap<KanjiResponse>,
  vocabularyLookup: SubjectIdMap<VocabularyResponse>,
  kanaVocabularyLookup: SubjectIdMap<KanaVocabularyResponse>,
): (assignment: AssignmentResponse) => boolean {
  return assignment => {
    // Check that the assignment is within the user's SRS range
    if (assignment.data.srs_stage <= srsRange.min) return false;
    if (assignment.data.srs_stage >= srsRange.max) return false;
    // Check that the assignment is for a subject type that the user has selected
    if (!selectedSubjectType[assignment.data.subject_type]) return false;
    // Check that the assignment is not hidden
    if (assignment.data.hidden) return false;

    const subject = getSubjectFromLookup(
      assignment.data.subject_id,
      assignment.data.subject_type,
      radicalLookup,
      kanjiLookup,
      vocabularyLookup,
      kanaVocabularyLookup,
    );

    // Subject not found in our current storage
    if (subject === undefined) return false;
    // Subject was moved to level above the user's level
    if (subject.data.level > user.level) return false;
    // Subject is not covered by the user's subscription
    if (subject.data.level > user.subscription.max_level_granted) return false;

    return true;
  };
}

export interface VocabSrsStage {
  vocab: SubjectResponse;
  srsStage: number;
}

/**
 * Selects between two vocabulary items based on SRS stage and subject type priority.
 *
 * The selection follows these rules in order:
 * 1. If the second item is undefined, returns the first
 * 2. If the first item has a lower SRS stage, returns the first
 * 3. If both items are of the same type, randomly selects one
 * 4. Otherwise, prioritizes by subject type in this order:
 *    - vocabulary
 *    - kana_vocabulary
 *    - kanji
 *    - radical
 *
 * @param a - The first vocabulary item to consider
 * @param b - The second vocabulary item to consider (optional)
 * @returns The selected vocabulary item based on the priority rules
 */
export function chooseVocab(a: VocabSrsStage, b: VocabSrsStage | undefined): VocabSrsStage {
  if (b === undefined) return a;
  if (a.srsStage !== b.srsStage) return a.srsStage < b.srsStage ? a : b;
  if (a.vocab.object === b.vocab.object) {
    // Randomly choose a or b;
    return Math.random() < 0.5 ? a : b;
  }
  if (a.vocab.object === 'vocabulary') return a;
  if (b.vocab.object === 'vocabulary') return b;
  if (a.vocab.object === 'kana_vocabulary') return a;
  if (b.vocab.object === 'kana_vocabulary') return b;
  if (a.vocab.object === 'kanji') return a;
  return b;
  // They can't both be radical, so it will have returned before here
}

export function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const SUBJECT_TYPE_PRIORITY: Record<SubjectType, number> = {
  vocabulary: 0,
  kana_vocabulary: 1,
  kanji: 2,
  radical: 3,
};

/**
 * Orders candidates for one English key, with the same rules as chooseVocab:
 * lower SRS stage first, then vocabulary, kana vocabulary, kanji, radical.
 * Ties use the subject id, so the order is stable.
 */
export function compareVocab(a: VocabSrsStage, b: VocabSrsStage): number {
  return (
    a.srsStage - b.srsStage ||
    SUBJECT_TYPE_PRIORITY[a.vocab.object] - SUBJECT_TYPE_PRIORITY[b.vocab.object] ||
    a.vocab.id - b.vocab.id
  );
}

function simplify(subject: VocabSrsStage, withContext: boolean): SimplifiedVocab {
  const { data } = subject.vocab;
  const vocab: SimplifiedVocab = {
    subjectId: subject.vocab.id,
    characters: data.characters!,
    subjectType: subject.vocab.object,
    srsStage: subject.srsStage,
    level: data.level,
  };
  if ('parts_of_speech' in data && data.parts_of_speech.length > 0) vocab.partsOfSpeech = data.parts_of_speech;
  if (withContext) {
    vocab.meanings = data.meanings.map(meaning => meaning.meaning);
    if ('context_sentences' in data) vocab.contextSentences = data.context_sentences.map(sentence => sentence.en);
  }
  return vocab;
}

/**
 * Builds the lookup from English meaning to subjects. Every key keeps all its
 * subjects with different characters: the first one is the default, and the
 * others are alternatives that the content script can select by context.
 */
export function buildVocabLookup(vocab: VocabSrsStage[]): VocabLookup {
  const byKey = new Map<string, VocabSrsStage[]>();
  for (const subject of vocab) {
    // TODO consider using the radical images if there are no characters
    if (subject.vocab.data.characters === null) continue;
    for (const meaning of subject.vocab.data.meanings) {
      const key = meaning.meaning.toLowerCase();
      const list = byKey.get(key);
      if (list === undefined) byKey.set(key, [subject]);
      else if (!list.includes(subject)) list.push(subject);
    }
  }

  const lookup: VocabLookup = {};
  for (const [key, subjects] of byKey) {
    subjects.sort(compareVocab);
    // Subjects with the same characters (for example the kanji and the
    // vocabulary 一) are the same translation, so keep only the first.
    const seen = new Set<string>();
    const unique = subjects.filter(subject => {
      const characters = subject.vocab.data.characters!;
      if (seen.has(characters)) return false;
      seen.add(characters);
      return true;
    });
    const ambiguous = unique.length > 1;
    const [first, ...rest] = unique.map(subject => simplify(subject, ambiguous));
    lookup[key] = ambiguous ? { ...first, alternatives: rest } : first;
  }
  return lookup;
}

/**
 * Updates the vocabulary replacement lookup based on current assignments and subjects.
 * This function:
 * 1. Filters assignments based on user preferences and SRS range
 * 2. Creates a lookup of vocabulary items by their meanings
 * 3. Stores the results in vocabToReplaceStorage
 */
export async function updateVocabToReplace() {
  const selectedSubjectType = await waniKaniSubjectTypeSelectionStorage.get();
  const srsRange = await wanikaniSrsRangeStorage.get();
  const user = await userStorage.getUserResponse();
  const radicalLookup = await radicalSubjectStorage.get();
  const kanjiLookup = await kanjiSubjectStorage.get();
  const vocabularyLookup = await vocabularySubjectStorage.get();
  const kanaVocabularyLookup = await kanaVocabularySubjectStorage.get();

  if (user === null) {
    vocabToReplaceStorage.set({ lookup: {} });
    return;
  }

  const assignmentFilter = createAssignmentFilter(
    selectedSubjectType,
    srsRange,
    user.data,
    radicalLookup.subjects,
    kanjiLookup.subjects,
    vocabularyLookup.subjects,
    kanaVocabularyLookup.subjects,
  );

  const assignments = await assignmentStorage.getAssignments(assignmentFilter);
  const vocab: VocabSrsStage[] = [];

  for (const assignment of assignments) {
    const subject = getSubjectFromLookup(
      assignment.data.subject_id,
      assignment.data.subject_type,
      radicalLookup.subjects,
      kanjiLookup.subjects,
      vocabularyLookup.subjects,
      kanaVocabularyLookup.subjects,
    );

    if (subject === undefined) continue;
    vocab.push({
      vocab: subject,
      srsStage: assignment.data.srs_stage,
    });
  }

  vocabToReplaceStorage.set({ lookup: buildVocabLookup(vocab) });
}
