import {
  IsString,
  IsOptional,
  MinLength,
  MaxLength,
  IsNotEmpty,
} from 'class-validator';

export class MovePageDto {
  @IsString()
  pageId: string;

  @IsString()
  @MinLength(5)
  @MaxLength(12)
  position: string;

  @IsOptional()
  @IsString()
  parentPageId?: string | null;

  @IsOptional()
  @IsString()
  directoryId?: string | null;

  @IsOptional()
  @IsString()
  topicId?: string | null;
}

export class MovePageToSpaceDto {
  @IsNotEmpty()
  @IsString()
  pageId: string;

  @IsNotEmpty()
  @IsString()
  spaceId: string;
}
