import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { EnvironmentService } from '../../../integrations/environment/environment.service';
import { AiAction, AiGenerateDto } from '../dto/ai.dto';
import { generateText, streamText } from 'ai';
import { AiContentPart } from './ai-file.service';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly environmentService: EnvironmentService,
  ) {}

  private getModel() {
    const driver = this.environmentService.getAiDriver();
    const modelName = this.environmentService.getAiCompletionModel();

    if (!driver || !modelName) {
      throw new BadRequestException(
        'AI is not configured. Please set AI_DRIVER and AI_COMPLETION_MODEL.',
      );
    }

    switch (driver) {
      case 'openai': {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { openai } = require('@ai-sdk/openai');
        return openai(modelName);
      }
      case 'openai-compatible': {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { createOpenAICompatible } = require('@ai-sdk/openai-compatible');
        const apiKey = this.environmentService.getOpenAiApiKey();
        const baseURL = this.environmentService.getOpenAiApiUrl();
        this.logger.debug(`openai-compatible: baseURL=${baseURL}, apiKey=${ apiKey ? apiKey.slice(0, 4) + '****' : 'not set'}`);
        const provider = createOpenAICompatible({
          baseURL,
          apiKey,
          name: 'openai-compatible',
        });
        return provider(modelName);
      }
      case 'gemini': {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { google } = require('@ai-sdk/google');
        return google(modelName);
      }
      case 'ollama': {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { ollama } = require('ai-sdk-ollama');
        return ollama(modelName);
      }
      default:
        throw new BadRequestException(`Unsupported AI driver: ${driver}`);
    }
  }

  async generate(dto: AiGenerateDto) {
    const model = this.getModel();
    const prompt = this.buildPrompt(dto.action, dto.content, dto.prompt);

    const result = await generateText({ model, prompt });

    return {
      content: result.text,
      usage: result.usage
        ? {
            promptTokens: result.usage.inputTokens ?? 0,
            completionTokens: result.usage.outputTokens ?? 0,
            totalTokens: (result.usage.inputTokens ?? 0) + (result.usage.outputTokens ?? 0),
          }
        : undefined,
    };
  }

  async *generateStream(dto: AiGenerateDto): AsyncGenerator<string> {
    const model = this.getModel();
    const prompt = this.buildPrompt(dto.action, dto.content, dto.prompt);

    this.logger.debug(`Starting stream with prompt length: ${prompt.length}`);
    const result = streamText({ model, prompt });

    let chunks = 0;
    for await (const chunk of result.textStream) {
      chunks++;
      yield chunk;
    }
    this.logger.debug(`Stream finished, total chunks: ${chunks}`);
  }

  async *streamWithFiles(
    systemPrompt: string,
    contentParts: AiContentPart[],
  ): AsyncGenerator<string> {
    const model = this.getModel();

    // Check if we have any image parts (need multi-modal messages format)
    const hasImages = contentParts.some((p) => p.type === 'image');

    if (!hasImages) {
      // Text-only: use simple prompt format (works with all providers)
      const textParts = contentParts
        .filter((p) => p.type === 'text')
        .map((p) => p.text)
        .join('\n\n');

      const fullPrompt = textParts
        ? `${textParts}\n\n---\n\n${systemPrompt}`
        : systemPrompt;

      this.logger.debug(
        `Starting streamWithFiles (text-only), prompt length=${fullPrompt.length}`,
      );

      const result = streamText({ model, prompt: fullPrompt });

      let chunks = 0;
      for await (const chunk of result.textStream) {
        chunks++;
        yield JSON.stringify({ content: chunk });
      }
      this.logger.debug(`streamWithFiles finished, total chunks: ${chunks}`);
      return;
    }

    // Multi-modal: use messages format with text + image parts
    const userContent: any[] = [];

    for (const part of contentParts) {
      if (part.type === 'text') {
        userContent.push({ type: 'text', text: part.text });
      } else if (part.type === 'image') {
        userContent.push({
          type: 'image',
          image: part.data,
          mimeType: part.mimeType,
        });
      }
    }

    userContent.push({ type: 'text', text: systemPrompt });

    this.logger.debug(
      `Starting streamWithFiles (multi-modal), ${contentParts.length} content parts`,
    );

    const result = streamText({
      model,
      messages: [{ role: 'user', content: userContent }],
    });

    let chunks = 0;
    for await (const chunk of result.textStream) {
      chunks++;
      yield JSON.stringify({ content: chunk });
    }
    this.logger.debug(`streamWithFiles finished, total chunks: ${chunks}`);
  }

  async *streamWithContext(
    systemPrompt: string,
    userPrompt: string,
    contentParts: AiContentPart[],
    history: { role: 'user' | 'assistant'; content: string }[] = [],
  ): AsyncGenerator<string> {
    const model = this.getModel();

    const messages: any[] = [];

    // System message (template + context)
    if (systemPrompt.trim()) {
      messages.push({ role: 'system', content: systemPrompt });
    }

    // Conversation history (already capped to 10 by controller)
    for (const msg of history) {
      messages.push({ role: msg.role, content: msg.content });
    }

    // Current user message with optional file attachments
    const hasImages = contentParts.some((p) => p.type === 'image');

    if (!hasImages) {
      const textParts = contentParts
        .filter((p) => p.type === 'text')
        .map((p) => p.text)
        .join('\n\n');

      const fullUserMessage = textParts
        ? `${textParts}\n\n---\n\n${userPrompt}`
        : userPrompt;

      messages.push({ role: 'user', content: fullUserMessage });
    } else {
      const userContent: any[] = [];
      for (const part of contentParts) {
        if (part.type === 'text') {
          userContent.push({ type: 'text', text: part.text });
        } else if (part.type === 'image') {
          userContent.push({
            type: 'image',
            image: part.data,
            mimeType: part.mimeType,
          });
        }
      }
      userContent.push({ type: 'text', text: userPrompt });
      messages.push({ role: 'user', content: userContent });
    }

    this.logger.debug(
      `Starting streamWithContext, ${messages.length} messages, history=${history.length}`,
    );

    const result = streamText({ model, messages });

    let chunks = 0;
    for await (const chunk of result.textStream) {
      chunks++;
      yield chunk;
    }
    this.logger.debug(`streamWithContext finished, total chunks: ${chunks}`);
  }

  private buildPrompt(
    action: AiAction | undefined,
    content: string,
    customPrompt?: string,
  ): string {
    const langInstruction = `IMPORTANT: Respond in the same language as the input text. Output ONLY the resulting text with no preamble, explanation, or meta-commentary.\n\n`;
    const prompts: Record<string, string> = {
      [AiAction.IMPROVE_WRITING]: `${langInstruction}Improve the following text. Keep the same meaning but make it clearer and more professional:\n\n${content}`,
      [AiAction.FIX_SPELLING_GRAMMAR]: `${langInstruction}Fix all spelling and grammar errors in the following text. Only fix errors, do not change the meaning:\n\n${content}`,
      [AiAction.MAKE_SHORTER]: `${langInstruction}Make the following text shorter while keeping the key points:\n\n${content}`,
      [AiAction.MAKE_LONGER]: `${langInstruction}Expand the following text with more details and examples:\n\n${content}`,
      [AiAction.SIMPLIFY]: `${langInstruction}Simplify the following text to make it easier to understand:\n\n${content}`,
      [AiAction.SUMMARIZE]: `${langInstruction}Summarize the following text concisely:\n\n${content}`,
      [AiAction.EXPLAIN]: `${langInstruction}Explain the following text in simple terms:\n\n${content}`,
      [AiAction.CONTINUE_WRITING]: `${langInstruction}Continue writing from where the following text left off, maintaining the same style and tone:\n\n${content}`,
      [AiAction.TRANSLATE]: `Output ONLY the translated text with no preamble or explanation. Translate the following text to ${customPrompt || 'English'}:\n\n${content}`,
      [AiAction.CHANGE_TONE]: `${langInstruction}Rewrite the following text in a ${customPrompt || 'professional'} tone:\n\n${content}`,
      [AiAction.CUSTOM]: `${customPrompt || ''}\n\n${content}`,
    };

    return prompts[action] || `${customPrompt || ''}\n\n${content}`;
  }
}
