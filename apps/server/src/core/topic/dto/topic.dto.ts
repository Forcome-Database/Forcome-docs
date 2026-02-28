import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform, TransformFnParams } from 'class-transformer';

export class TopicIdDto {
  @IsString()
  @IsNotEmpty()
  @IsUUID()
  topicId: string;
}

export class TopicListDto {
  @IsString()
  @IsNotEmpty()
  @IsUUID()
  directoryId: string;
}

export class CreateTopicDto {
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
  directoryId: string;
}

export class UpdateTopicDto {
  @IsString()
  @IsNotEmpty()
  @IsUUID()
  topicId: string;

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
