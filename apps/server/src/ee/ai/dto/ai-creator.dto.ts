import { IsNotEmpty, IsOptional, IsString, IsIn } from 'class-validator';

export class AiCreatorGenerateDto {
  @IsNotEmpty()
  @IsString()
  prompt: string;

  @IsOptional()
  @IsString()
  template?: string;

  @IsNotEmpty()
  @IsString()
  pageId: string;

  @IsOptional()
  @IsString()
  @IsIn(['append', 'overwrite'])
  insertMode?: string;

  @IsOptional()
  @IsString()
  existingContentSummary?: string;

  @IsOptional()
  @IsString()
  pageTitle?: string;
}
