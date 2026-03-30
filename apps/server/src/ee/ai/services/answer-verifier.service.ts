import { Injectable, Logger } from '@nestjs/common';

export interface VerificationResult {
  isGrounded: boolean;
  confidence: number;       // 0-1
  ungroundedClaims: string[]; // Claims not supported by context
}

const VERIFY_PROMPT = `You are a groundedness checker for a knowledge base Q&A system.
Given an AI answer and the context it used, identify claims in the answer that are NOT supported by the context.

Rules:
- Only flag claims that are factually asserted but have no supporting evidence in the context.
- Hedged statements ("might", "could", "可能") are NOT ungrounded.
- Meta-statements ("I don't have enough information") are NOT ungrounded.
- Summaries and paraphrases of context content are grounded.
- URLs that appear in context are grounded even if reformatted.

Context:
---
{context}
---

Answer:
---
{answer}
---

Return ONLY valid JSON, no markdown: {"isGrounded": true/false, "confidence": 0.0-1.0, "ungroundedClaims": ["claim1", ...]}`;

@Injectable()
export class AnswerVerifierService {
  private readonly logger = new Logger(AnswerVerifierService.name);

  async verify(
    answer: string,
    context: string,
    liteModel: any,
  ): Promise<VerificationResult> {
    // Skip verification for very short answers
    if (answer.length < 100) {
      return { isGrounded: true, confidence: 1, ungroundedClaims: [] };
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { generateText } = require('ai');
      const prompt = VERIFY_PROMPT
        .replace('{context}', context.slice(0, 8000))
        .replace('{answer}', answer.slice(0, 3000));

      const { text } = await generateText({
        model: liteModel,
        prompt,
        maxTokens: 300,
        temperature: 0,
      });

      const cleaned = text.replace(/```json?\s*/g, '').replace(/```\s*/g, '').trim();
      const parsed = JSON.parse(cleaned);
      return {
        isGrounded: !!parsed.isGrounded,
        confidence: Math.min(1, Math.max(0, Number(parsed.confidence) || 0)),
        ungroundedClaims: Array.isArray(parsed.ungroundedClaims)
          ? parsed.ungroundedClaims.map(String)
          : [],
      };
    } catch (error) {
      this.logger.debug(`Groundedness check failed (non-blocking): ${error}`);
      return { isGrounded: true, confidence: 0.5, ungroundedClaims: [] };
    }
  }

  checkCompleteness(
    answer: string,
    entities: string[],
  ): { isComplete: boolean; missingEntities: string[] } {
    if (entities.length === 0) return { isComplete: true, missingEntities: [] };
    const answerLower = answer.toLowerCase();
    const missing = entities.filter(e => !answerLower.includes(e.toLowerCase()));
    return { isComplete: missing.length === 0, missingEntities: missing };
  }
}
