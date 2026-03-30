/**
 * Token budget allocator for RAG context assembly.
 * Ensures total context fits within model context window.
 *
 * Rough token estimation: 1 token ≈ 3.5 chars (EN) / 1.5 chars (CJK).
 * We use a conservative 2 chars/token to handle mixed content safely.
 */

const CHARS_PER_TOKEN = 2;

export interface TokenBudget {
  /** Max chars for current page context */
  currentPage: number;
  /** Max chars per retrieved chunk */
  perChunk: number;
  /** Max chars for all web evidence combined */
  webEvidence: number;
  /** Max chars for conversation history */
  history: number;
}

export function allocateTokenBudget(
  modelContextTokens: number,
  maxOutputTokens: number,
  systemPromptChars: number,
  retrievedCount: number,
  webEvidenceCount: number,
  hasHistory: boolean,
): TokenBudget {
  const systemPromptTokens = Math.ceil(systemPromptChars / CHARS_PER_TOKEN);
  const availableTokens = modelContextTokens - maxOutputTokens - systemPromptTokens;
  const availableChars = Math.max(0, availableTokens * CHARS_PER_TOKEN);

  // Budget allocation ratios
  const currentPageRatio = 0.40;
  const chunksRatio = 0.30;
  const historyRatio = hasHistory ? 0.15 : 0;
  const webRatio = webEvidenceCount > 0 ? 0.15 : 0;

  // Redistribute unused ratios proportionally
  const usedRatio = currentPageRatio + chunksRatio + historyRatio + webRatio;
  const scale = 1 / usedRatio;

  const currentPage = Math.floor(availableChars * currentPageRatio * scale);
  const totalChunks = Math.floor(availableChars * chunksRatio * scale);
  const perChunk = retrievedCount > 0 ? Math.floor(totalChunks / retrievedCount) : 0;
  const webEvidence = Math.floor(availableChars * webRatio * scale);
  const history = Math.floor(availableChars * historyRatio * scale);

  return { currentPage, perChunk, webEvidence, history };
}
