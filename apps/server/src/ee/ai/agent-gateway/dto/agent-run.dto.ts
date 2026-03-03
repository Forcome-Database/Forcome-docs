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
}
