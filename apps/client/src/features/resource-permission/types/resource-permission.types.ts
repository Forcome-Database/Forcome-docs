export interface ResourcePermissionRecord {
  id: string;
  resourceType: 'directory' | 'page';
  resourceId: string;
  principalType: 'user' | 'group';
  principalId: string;
  role: 'admin' | 'writer' | 'reader' | 'none';
  createdAt: string;
  principalName?: string | null;
  principalEmail?: string | null;
  principalAvatarUrl?: string | null;
}
