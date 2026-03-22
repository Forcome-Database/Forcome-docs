import { IsString, IsOptional, IsArray } from 'class-validator';

export class AgentRunDto {
  @IsString()
  prompt: string;

  @IsString()
  pageId: string;

  @IsOptional()
  @IsString()
  templateId?: string;

  @IsOptional()
  @IsString()
  insertMode?: string;

  @IsOptional()
  @IsString()
  pageTitle?: string;

  @IsOptional()
  @IsArray()
  history?: { role: string; content: string }[];

  @IsOptional()
  @IsString()
  pageContent?: string;

  @IsOptional()
  @IsString()
  selectedText?: string;

  @IsOptional()
  @IsString()
  intentRoute?: string;

  @IsOptional()
  @IsString()
  threadId?: string;

  @IsOptional()
  @IsArray()
  conversationHistory?: { role: string; content: string }[];

  @IsOptional()
  @IsString()
  operation?: string;

  @IsOptional()
  documentTask?: Record<string, unknown>;
}
