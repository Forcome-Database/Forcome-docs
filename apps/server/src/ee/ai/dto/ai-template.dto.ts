import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export enum AiTemplateScope {
  WORKSPACE = 'workspace',
  USER = 'user',
}

export class CreateAiTemplateDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  key: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(200)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  icon?: string;

  @IsNotEmpty()
  @IsString()
  prompt: string;

  @IsNotEmpty()
  @IsEnum(AiTemplateScope)
  scope: AiTemplateScope;
}

export class UpdateAiTemplateDto {
  @IsNotEmpty()
  @IsString()
  templateId: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  icon?: string;

  @IsOptional()
  @IsString()
  prompt?: string;
}

export class DeleteAiTemplateDto {
  @IsNotEmpty()
  @IsString()
  templateId: string;
}

export class ResetAiTemplateDto {
  @IsNotEmpty()
  @IsString()
  key: string;
}

export class UpdateAiSystemPromptDto {
  @IsString()
  systemPrompt: string;
}
