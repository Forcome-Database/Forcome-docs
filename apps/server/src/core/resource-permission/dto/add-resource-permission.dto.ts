import { IsIn, IsUUID } from 'class-validator';

export class AddResourcePermissionDto {
  @IsIn(['directory', 'page'])
  resourceType: 'directory' | 'page';

  @IsUUID()
  resourceId: string;

  @IsIn(['user', 'group'])
  principalType: 'user' | 'group';

  @IsUUID()
  principalId: string;

  @IsIn(['admin', 'writer', 'reader', 'none'])
  role: string;
}
