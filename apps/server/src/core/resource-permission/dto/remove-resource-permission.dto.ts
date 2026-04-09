import { IsUUID } from 'class-validator';

export class RemoveResourcePermissionDto {
  @IsUUID()
  id: string;
}
