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
  @IsIn(['create', 'append', 'overwrite', 'replace'])
  insertMode?: string;

  @IsOptional()
  @IsString()
  existingContentSummary?: string;

  @IsOptional()
  @IsString()
  pageTitle?: string;

  @IsOptional()
  @IsString()
  history?: string;

  @IsOptional()
  @IsString()
  confirmedOutline?: string;

  @IsOptional()
  @IsString()
  planningEnabled?: string;
}
