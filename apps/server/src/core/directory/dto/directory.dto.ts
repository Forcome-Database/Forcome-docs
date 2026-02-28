import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform, TransformFnParams } from 'class-transformer';

export class DirectoryIdDto {
  @IsString()
  @IsNotEmpty()
  @IsUUID()
  directoryId: string;
}

export class DirectoryListDto {
  @IsString()
  @IsNotEmpty()
  @IsUUID()
  spaceId: string;
}

export class CreateDirectoryDto {
  @MinLength(1)
  @MaxLength(200)
  @IsString()
  @Transform(({ value }: TransformFnParams) => value?.trim())
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  icon?: string;

  @IsString()
  @IsNotEmpty()
  @IsUUID()
  spaceId: string;
}

export class UpdateDirectoryDto {
  @IsString()
  @IsNotEmpty()
  @IsUUID()
  directoryId: string;

  @IsOptional()
  @MinLength(1)
  @MaxLength(200)
  @IsString()
  @Transform(({ value }: TransformFnParams) => value?.trim())
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  icon?: string;
}
