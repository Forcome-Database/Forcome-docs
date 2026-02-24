import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { EnvironmentService } from '../../../integrations/environment/environment.service';
import { AiAction, AiGenerateDto } from '../dto/ai.dto';
import { generateText, streamText } from 'ai';

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
        const envKey = process.env.OPENAI_API_KEY;
        this.logger.debug(`openai-compatible: baseURL=${baseURL}`);
        this.logger.debug(`apiKey from configService: length=${apiKey?.length}, value="${apiKey}"`);
        this.logger.debug(`apiKey from process.env:   length=${envKey?.length}, value="${envKey}"`);
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
      yield JSON.stringify({ content: chunk });
    }
    this.logger.debug(`Stream finished, total chunks: ${chunks}`);
  }

  private buildPrompt(
    action: AiAction | undefined,
    content: string,
    customPrompt?: string,
  ): string {
    const prompts: Record<string, string> = {
      [AiAction.IMPROVE_WRITING]: `Improve the following text. Keep the same meaning but make it clearer and more professional:\n\n${content}`,
      [AiAction.FIX_SPELLING_GRAMMAR]: `Fix all spelling and grammar errors in the following text. Only fix errors, do not change the meaning:\n\n${content}`,
      [AiAction.MAKE_SHORTER]: `Make the following text shorter while keeping the key points:\n\n${content}`,
      [AiAction.MAKE_LONGER]: `Expand the following text with more details and examples:\n\n${content}`,
      [AiAction.SIMPLIFY]: `Simplify the following text to make it easier to understand:\n\n${content}`,
      [AiAction.SUMMARIZE]: `Summarize the following text concisely:\n\n${content}`,
      [AiAction.EXPLAIN]: `Explain the following text in simple terms:\n\n${content}`,
      [AiAction.CONTINUE_WRITING]: `Continue writing from where the following text left off, maintaining the same style and tone:\n\n${content}`,
      [AiAction.TRANSLATE]: `Translate the following text to ${customPrompt || 'English'}:\n\n${content}`,
      [AiAction.CHANGE_TONE]: `Rewrite the following text in a ${customPrompt || 'professional'} tone:\n\n${content}`,
      [AiAction.CUSTOM]: `${customPrompt || ''}\n\n${content}`,
    };

    return prompts[action] || `${customPrompt || ''}\n\n${content}`;
  }
}
