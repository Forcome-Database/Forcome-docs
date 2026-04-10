export enum EventName {
  COLLAB_PAGE_UPDATED = 'collab.page.updated',
  PAGE_CREATED = 'page.created',
  PAGE_UPDATED = 'page.updated',
  PAGE_CONTENT_UPDATED = 'page-content-updated',
  PAGE_MOVED_TO_SPACE = 'page-moved-to-space',
  PAGE_DELETED = 'page.deleted',
  PAGE_SOFT_DELETED = 'page.soft_deleted',
  PAGE_RESTORED = 'page.restored',

  DIRECTORY_DELETED = 'directory.deleted',

  SPACE_CREATED = 'space.created',
  SPACE_UPDATED = 'space.updated',
  SPACE_DELETED = 'space.deleted',

  WORKSPACE_CREATED = 'workspace.created',
  WORKSPACE_UPDATED = 'workspace.updated',
  WORKSPACE_DELETED = 'workspace.deleted',

  SPACE_MEMBER_REMOVED = 'space-member.removed',
  WORKSPACE_USER_DELETED = 'workspace-user.deleted',
}
