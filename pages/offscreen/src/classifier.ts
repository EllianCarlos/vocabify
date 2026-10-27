/**
 * Chooses the translation whose sense texts (meanings and WaniKani context
 * sentences) are most similar to the sentence on the page.
 */

export interface SenseCandidate {
  subjectId: number;
  texts: string[];
}

export interface SenseQuery {
  sentence: string;
  start: number;
  word: string;
  candidates: SenseCandidate[];
}

export interface ScoredCandidate {
  subjectId: number;
  score: number;
}

export interface Choice {
  subjectId: number | null;
  scores: ScoredCandidate[];
}

/** If the best two scores are closer than this, the model is not sure. */
export const DEFAULT_MIN_MARGIN = 0.02;

export function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

/** Scores each candidate by its most similar sense text. */
export function scoreCandidates(
  query: Float32Array,
  candidates: { subjectId: number; vectors: Float32Array[] }[],
): ScoredCandidate[] {
  return candidates.map(({ subjectId, vectors }) => ({
    subjectId,
    score: vectors.length > 0 ? Math.max(...vectors.map(vector => dot(query, vector))) : -1,
  }));
}

/** Returns the best candidate, or null if it does not win by `minMargin`. */
export function choose(scores: ScoredCandidate[], minMargin = DEFAULT_MIN_MARGIN): Choice {
  const sorted = [...scores].sort((a, b) => b.score - a.score);
  const [best, second] = sorted;
  if (best === undefined || best.score < 0) return { subjectId: null, scores };
  if (second !== undefined && best.score - second.score < minMargin) return { subjectId: null, scores };
  return { subjectId: best.subjectId, scores };
}

export type Embed = (texts: string[]) => Promise<Float32Array[]>;

/** Removes texts that every candidate has: they cannot tell the candidates apart. */
export function distinctTexts(candidates: SenseCandidate[]): SenseCandidate[] {
  if (candidates.length < 2) return candidates;
  const shared = candidates[0].texts.filter(text => candidates.every(c => c.texts.includes(text)));
  return candidates.map(c => ({ subjectId: c.subjectId, texts: c.texts.filter(text => !shared.includes(text)) }));
}

/** Classifies a batch of queries with one call to `embed` for all new texts. */
export async function classify(embed: Embed, input: SenseQuery[], minMargin = DEFAULT_MIN_MARGIN): Promise<Choice[]> {
  const queries = input.map(query => ({ ...query, candidates: distinctTexts(query.candidates) }));
  const texts = queries.flatMap(query => [query.sentence, ...query.candidates.flatMap(c => c.texts)]);
  const vectors = await embed(texts);
  const byText = new Map(texts.map((text, i) => [text, vectors[i]]));
  return queries.map(query => {
    const scores = scoreCandidates(
      byText.get(query.sentence)!,
      query.candidates.map(c => ({ subjectId: c.subjectId, vectors: c.texts.map(text => byText.get(text)!) })),
    );
    return choose(scores, minMargin);
  });
}
