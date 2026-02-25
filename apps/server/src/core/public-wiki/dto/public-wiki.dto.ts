import { IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class PublicSidebarDto {
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

export class PublicAiAnswerDto {
  @IsNotEmpty()
  @IsString()
  query: string;
}
