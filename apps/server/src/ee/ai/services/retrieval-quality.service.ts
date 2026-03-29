import { Injectable, Logger } from '@nestjs/common';
import { QueryIntent } from './query-understanding.service';

export type RetrievalConfidence = 'high' | 'medium' | 'low';

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

@Injectable()
export class RetrievalQualityService {
  private readonly logger = new Logger(RetrievalQualityService.name);

  /**
   * Assess whether retrieved chunks can answer the given query.
   * Runs after rerank, before LLM generation — the answerability gate.
   */
  async assess(
    query: string,
    intent: QueryIntent,
    retrievedChunks: RetrievedChunk[],
    currentPageTitle: string | undefined,
    model: any,
  ): Promise<RetrievalQualityResult> {
    // Fast path: no results at all
    if (!retrievedChunks || retrievedChunks.length === 0) {
      return {
        confidence: 'low',
        isPublicTopic: this.guessPublicTopic(query),
      };
    }

    // Fast path: top result has a strong score — skip LLM
    const topScore = retrievedChunks[0]?.score ?? 0;
    if (topScore > 0.03) {
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

      const validConfidences: RetrievalConfidence[] = ['high', 'medium', 'low'];
      const confidence: RetrievalConfidence = validConfidences.includes(
        parsed.confidence,
      )
        ? (parsed.confidence as RetrievalConfidence)
        : 'medium';

      const isPublicTopic =
        typeof parsed.isPublicTopic === 'boolean' ? parsed.isPublicTopic : false;

      return { confidence, isPublicTopic };
    } catch (err: any) {
      // Fail-open: don't block generation on assessment errors
      this.logger.warn(
        `Retrieval quality assessment failed (fail-open): ${err?.message}`,
      );
      return { confidence: 'medium', isPublicTopic: false };
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
