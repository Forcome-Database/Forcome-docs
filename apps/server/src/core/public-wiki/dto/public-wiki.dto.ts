import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsArray,
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

export class PublicAiAnswerDto {
  @IsNotEmpty()
  @IsString()
  query: string;

  @IsOptional()
  @IsString()
  pageSlugId?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AiImageDto)
  images?: AiImageDto[];
}
