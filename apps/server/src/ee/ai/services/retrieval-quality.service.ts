import { Injectable, Logger } from '@nestjs/common';
import { QueryIntent } from './query-understanding.service';

export type RetrievalConfidence = 'exact' | 'high' | 'partial' | 'tangential' | 'none';

export interface RetrievalQualityResult {
  confidence: RetrievalConfidence;
  isPublicTopic: boolean;
}

interface RetrievedChunk {
  chunkText?: string;
  textContent?: string;
  score?: number;
  pageTitle?: string;
}

const ASSESS_PROMPT = `You are a retrieval quality assessor for a knowledge base Q&A system.
Given a user query and summaries of the top retrieved documents, determine whether the retrieved content can actually answer the question.

KEY HEURISTIC: If the user asks a troubleshooting/diagnostic question but the results only contain setup/installation instructions, that's LOW — the results don't match the question type.

Additional heuristics:
- If the results are clearly about a different topic than the query, that's LOW.
- If the results partially address the query but miss the core question, that's MEDIUM.
- If the results directly address the query's main concern, that's HIGH.
- If the query is about a well-known public technology/concept not present in the results, set isPublicTopic to true.

Return ONLY valid JSON, no markdown:
{"confidence": "high" | "medium" | "low", "isPublicTopic": true | false}

- confidence: "high" = results can likely answer the question, "medium" = partial match, "low" = results cannot answer
- isPublicTopic: true if the query is about a common public technology, framework, or concept that exists in widely available documentation (e.g. React, Docker, Python, SQL, Linux, etc.)`;

// Common public-domain technical terms that suggest the question can be answered
// from general knowledge even if the KB doesn't have relevant results.
const PUBLIC_TOPIC_PATTERNS = [
  /\b(react|vue|angular|svelte|next\.?js|nuxt|remix)\b/i,
  /\b(node\.?js|nodejs|deno|bun)\b/i,
  /\b(typescript|javascript|python|java|golang|rust|ruby|php|c#|c\+\+)\b/i,
  /\b(docker|kubernetes|k8s|helm|podman)\b/i,
  /\b(postgres|postgresql|mysql|sqlite|mongodb|redis|elasticsearch)\b/i,
  /\b(aws|azure|gcp|google cloud|cloudflare|vercel|netlify)\b/i,
  /\b(git|github|gitlab|bitbucket)\b/i,
  /\b(linux|ubuntu|debian|centos|macos|windows)\b/i,
  /\b(nginx|apache|caddy|traefik)\b/i,
  /\b(http|https|rest|graphql|grpc|websocket|oauth|jwt)\b/i,
  /\b(css|html|tailwind|bootstrap|sass|scss)\b/i,
  /\b(webpack|vite|rollup|esbuild|babel)\b/i,
  /\b(npm|yarn|pnpm|pip|cargo|maven|gradle)\b/i,
  /\b(sql|nosql|orm|query|database|migration|schema)\b/i,
  /\b(bash|shell|zsh|powershell|terminal|cli)\b/i,
];

export function computeEntityCoverage(
  entities: string[],
  searchFacets: string[],
  topChunks: Array<{ chunkText?: string; textContent?: string }>,
): number {
  if (entities.length === 0) return 1;
  const combinedText = topChunks.slice(0, 3)
    .map(c => (c.chunkText || c.textContent || '').toLowerCase())
    .join(' ');

  const matched = entities.filter(entity => {
    const eLower = entity.toLowerCase();
    if (combinedText.includes(eLower)) return true;
    return searchFacets.some(facet =>
      facet.toLowerCase().includes(eLower) &&
      facet.toLowerCase() !== eLower &&
      combinedText.includes(facet.toLowerCase()),
    );
  });
  return matched.length / entities.length;
}

@Injectable()
export class RetrievalQualityService {
  private readonly logger = new Logger(RetrievalQualityService.name);

  /**
   * Assess whether retrieved chunks can answer the given query.
   * Runs after rerank, before LLM generation — the answerability gate.
   *
   * Returns a 5-level confidence: exact > high > partial > tangential > none.
   */
  async assess(
    query: string,
    intent: QueryIntent,
    retrievedChunks: RetrievedChunk[],
    currentPageTitle: string | undefined,
    model: any,
    entityCoverage: number,
    normalizedScore: number,
  ): Promise<RetrievalQualityResult> {
    // Fast path: no results at all
    if (!retrievedChunks || retrievedChunks.length === 0) {
      return {
        confidence: 'none',
        isPublicTopic: this.guessPublicTopic(query),
      };
    }

    // Fast path: very strong score + simple intent + high entity coverage → exact
    const simpleIntents: QueryIntent[] = ['factual', 'follow_up'];
    if (normalizedScore > 0.015 && simpleIntents.includes(intent) && entityCoverage >= 0.8) {
      return { confidence: 'exact', isPublicTopic: false };
    }

    // Fast path: strong score + good entity coverage → high
    if (normalizedScore > 0.012 && entityCoverage >= 0.6) {
      return { confidence: 'high', isPublicTopic: false };
    }

    // LLM assessment for borderline cases
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { generateText } = require('ai');

      const topChunks = retrievedChunks.slice(0, 3);
      const resultSummaries = topChunks
        .map((chunk, idx) => {
          const text = (chunk.chunkText || chunk.textContent || '').slice(0, 400);
          const title = chunk.pageTitle ? ` (from "${chunk.pageTitle}")` : '';
          return `Result ${idx + 1}${title}:\n${text}`;
        })
        .join('\n\n');

      const pageContext = currentPageTitle
        ? `The user is viewing a page titled: "${currentPageTitle}".\n\n`
        : '';

      const userContent =
        `${pageContext}Query intent: ${intent}\n` +
        `User query: ${query}\n\n` +
        `Top retrieved results:\n${resultSummaries}`;

      const { text } = await generateText({
        model,
        maxTokens: 80,
        temperature: 0,
        messages: [
          { role: 'system', content: ASSESS_PROMPT },
          { role: 'user', content: userContent },
        ],
      });

      const cleaned = text
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '')
        .trim();

      const parsed = JSON.parse(cleaned);

      const validLlmConfidences = ['high', 'medium', 'low'] as const;
      type LlmConfidence = (typeof validLlmConfidences)[number];
      const llmConfidence: LlmConfidence = validLlmConfidences.includes(parsed.confidence)
        ? (parsed.confidence as LlmConfidence)
        : 'medium';

      const isPublicTopic =
        typeof parsed.isPublicTopic === 'boolean' ? parsed.isPublicTopic : false;

      // Map LLM 3-level + entityCoverage → 5-level confidence
      let confidence: RetrievalConfidence;
      if (llmConfidence === 'high' && entityCoverage >= 0.6) {
        confidence = 'high';
      } else if ((llmConfidence === 'high' || llmConfidence === 'medium') && entityCoverage >= 0.4) {
        confidence = 'partial';
      } else if (llmConfidence === 'low' && !isPublicTopic) {
        confidence = 'none';
      } else {
        confidence = 'tangential';
      }

      return { confidence, isPublicTopic };
    } catch (err: any) {
      // Fail-open: don't block generation on assessment errors
      this.logger.warn(
        `Retrieval quality assessment failed (fail-open): ${err?.message}`,
      );
      return { confidence: 'partial', isPublicTopic: false };
    }
  }

  /**
   * Heuristic fallback: guess whether the query is about a common public
   * technology topic, used when there are no results and no LLM call is made.
   */
  private guessPublicTopic(query: string): boolean {
    return PUBLIC_TOPIC_PATTERNS.some((pattern) => pattern.test(query));
  }
}
