import { IsIn, IsUUID } from 'class-validator';

export class UpdateResourcePermissionDto {
  @IsUUID()
  id: string;

  @IsIn(['admin', 'writer', 'reader', 'none'])
  role: string;
}
