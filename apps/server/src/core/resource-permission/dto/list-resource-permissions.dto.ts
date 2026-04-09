import { IsIn, IsUUID } from 'class-validator';

export class ListResourcePermissionsDto {
  @IsIn(['directory', 'page'])
  resourceType: 'directory' | 'page';

  @IsUUID()
  resourceId: string;
}
