import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsArray,
  IsBoolean,
  MaxLength,
  Matches,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class PublicSidebarDto {
  @IsNotEmpty()
  @IsString()
  spaceSlug: string;

  @IsOptional()
  @IsString()
  directoryId?: string;
}

export class PublicDirectoriesDto {
  @IsNotEmpty()
  @IsString()
  spaceSlug: string;
}

export class PublicPageDto {
  @IsOptional()
  @IsString()
  pageId?: string;

  @IsOptional()
  @IsString()
  slugId?: string;

  @IsOptional()
  @IsString()
  format?: 'html' | 'markdown';
}

export class PublicSearchDto {
  @IsNotEmpty()
  @IsString()
  query: string;

  @IsOptional()
  @IsString()
  spaceSlug?: string;

  @IsOptional()
  @IsNumber()
  limit?: number;
}

class AiImageDto {
  @IsString()
  data: string;

  @IsString()
  mimeType: string;
}

export class AiHistoryMessageDto {
  @IsString()
  role: 'user' | 'assistant';

  @IsString()
  content: string;
}

export class PublicAiAnswerDto {
  @IsNotEmpty()
  @IsString()
  query: string;

  @IsOptional()
  @IsString()
  pageSlugId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(/^[a-f0-9-]{36}$/, { message: 'sessionId must be a valid UUID format' })
  sessionId?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AiImageDto)
  images?: AiImageDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AiHistoryMessageDto)
  history?: AiHistoryMessageDto[];

  @IsOptional()
  @IsBoolean()
  deepResearch?: boolean;
}
