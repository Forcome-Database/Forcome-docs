import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CategorizePageDto {
  @IsNotEmpty()
  @IsString()
  pageId: string;

  @IsOptional()
  @IsString()
  directoryId?: string | null;

  @IsOptional()
  @IsString()
  topicId?: string | null;
}
