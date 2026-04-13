import { PartialType } from '@nestjs/mapped-types';
import { CreateSpaceDto } from './create-space.dto';
import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class UpdateSpaceDto extends PartialType(CreateSpaceDto) {
  @IsString()
  @IsNotEmpty()
  @IsUUID()
  spaceId: string;

  @IsOptional()
  @IsBoolean()
  disablePublicSharing: boolean;

  @IsOptional()
  @IsString()
  @IsIn(['open', 'private'])
  visibility?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  position?: string;
}
