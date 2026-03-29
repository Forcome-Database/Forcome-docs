import { Injectable, Logger } from '@nestjs/common';
import { AiChatMessage } from './ai-search.service';

export type QueryIntent =
  | 'factual'
  | 'procedural'
  | 'conceptual'
  | 'troubleshooting'
  | 'comparison'
  | 'follow_up';

export type QueryComplexity = 1 | 2 | 3;

export interface QueryUnderstandingResult {
  intent: QueryIntent;
  complexity: QueryComplexity;
  rewrittenQuery: string;
  needsClarification: boolean;
  clarificationQuestion?: string;
  isOutOfScope: boolean;
}

@Injectable()
export class QueryUnderstandingService {
  private readonly logger = new Logger(QueryUnderstandingService.name);

  async classifyAndRewrite(
    query: string,
    history: AiChatMessage[],
    currentPageTitle: string | undefined,
    liteModel: any,
  ): Promise<QueryUnderstandingResult> {
    const fallback: QueryUnderstandingResult = {
      intent: 'factual',
      complexity: 1,
      rewrittenQuery: query,
      needsClarification: false,
      isOutOfScope: false,
    };

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { generateText } = require('ai');

      const historyContext =
        history.length > 0
          ? history
              .slice(-6)
              .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
              .join('\n')
          : '';

      const pageContext = currentPageTitle
        ? `The user is currently viewing a page titled: "${currentPageTitle}".`
        : '';

      const systemPrompt = `You are a query understanding assistant for a knowledge base Q&A system. Analyze the user's query and return a JSON object.

Return ONLY a valid JSON object with these fields:
- intent: one of "factual" | "procedural" | "conceptual" | "troubleshooting" | "comparison" | "follow_up"
- complexity: integer 1 (simple lookup), 2 (moderate, needs synthesis), or 3 (complex, multi-step reasoning)
- rewrittenQuery: a standalone, self-contained version of the query. If the query contains pronouns or references to prior conversation, rewrite it as a full question without such references.
- needsClarification: boolean — true if the query is too vague to answer well
- clarificationQuestion: string (only when needsClarification is true) — a focused question to ask the user
- isOutOfScope: boolean — true if the query is unrelated to the knowledge base (e.g. weather, jokes, general trivia)

Query rewriting rules:
- Resolve pronouns and elliptical references using conversation history.
- Examples:
  - Prior context: "Docker 部署", follow-up: "那端口怎么配?" → rewrittenQuery: "Docker 部署时如何配置端口？"
  - Prior context: comparing approach A and approach B, follow-up: "第一个怎么实现?" → rewrittenQuery: "A方案的具体实现方式是什么？"
- If the query is already standalone and clear, keep it as-is or make minor improvements.
- Always return a rewrittenQuery — never leave it empty.

Intent definitions:
- factual: asking for a specific fact or piece of information
- procedural: asking how to do something step-by-step
- conceptual: asking to explain a concept or idea
- troubleshooting: asking to diagnose or fix a problem
- comparison: asking to compare two or more things
- follow_up: a continuation of the current conversation that references prior context`;

      const userContent = [
        pageContext,
        historyContext ? `Conversation history:\n${historyContext}` : '',
        `Current query: ${query}`,
      ]
        .filter(Boolean)
        .join('\n\n');

      const { text } = await generateText({
        model: liteModel,
        maxTokens: 300,
        temperature: 0,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
      });

      // Strip markdown code fences if present
      const cleaned = text
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '')
        .trim();

      const parsed = JSON.parse(cleaned);

      const intent: QueryIntent =
        [
          'factual',
          'procedural',
          'conceptual',
          'troubleshooting',
          'comparison',
          'follow_up',
        ].includes(parsed.intent)
          ? (parsed.intent as QueryIntent)
          : 'factual';

      const rawComplexity = parseInt(parsed.complexity, 10);
      const complexity: QueryComplexity =
        rawComplexity === 1 || rawComplexity === 2 || rawComplexity === 3
          ? rawComplexity
          : 1;

      const rewrittenQuery =
        typeof parsed.rewrittenQuery === 'string' && parsed.rewrittenQuery.trim()
          ? parsed.rewrittenQuery.trim()
          : query;

      const needsClarification = Boolean(parsed.needsClarification);
      const clarificationQuestion =
        needsClarification && typeof parsed.clarificationQuestion === 'string'
          ? parsed.clarificationQuestion
          : undefined;

      const isOutOfScope = Boolean(parsed.isOutOfScope);

      return {
        intent,
        complexity,
        rewrittenQuery,
        needsClarification,
        clarificationQuestion,
        isOutOfScope,
      };
    } catch (err: any) {
      this.logger.warn(
        `Query understanding failed, using fallback: ${err?.message}`,
      );
      return fallback;
    }
  }
}
