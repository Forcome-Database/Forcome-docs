import { IsBoolean, IsOptional, IsString, IsUUID } from 'class-validator';
import { SpaceIdDto } from './page.dto';

export class SidebarPageDto {
  @IsOptional()
  @IsUUID()
  spaceId: string;

  @IsOptional()
  @IsString()
  pageId: string;

  @IsOptional()
  @IsUUID()
  directoryId?: string;

  @IsOptional()
  @IsUUID()
  topicId?: string;

  @IsOptional()
  @IsBoolean()
  filterUncategorized?: boolean;
}
