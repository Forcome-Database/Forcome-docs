import { Type } from 'class-transformer';
import {
  IsIn,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class AiCreatorCommitSelectionSnapshotDto {
  @IsString()
  text: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  from: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  to: number;
}

export class AiCreatorCommitDto {
  @IsString()
  pageId: string;

  @IsString()
  content: string;

  @IsISO8601()
  expectedUpdatedAt: string;

  @IsIn(['create', 'append', 'overwrite', 'replace'])
  insertMode: 'create' | 'append' | 'overwrite' | 'replace';

  @ValidateIf((dto) => dto.insertMode === 'replace')
  @ValidateNested()
  @Type(() => AiCreatorCommitSelectionSnapshotDto)
  @IsOptional()
  selectionSnapshot?: AiCreatorCommitSelectionSnapshotDto;
}
