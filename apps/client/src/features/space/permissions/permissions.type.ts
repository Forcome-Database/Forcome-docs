export enum SpaceCaslAction {
  Manage = "manage",
  Create = "create",
  Read = "read",
  Edit = "edit",
  Delete = "delete",
}
export enum SpaceCaslSubject {
  Settings = "settings",
  Member = "member",
  Page = "page",
  Share = "share",
  Directory = "directory",
}

export type SpaceAbility =
  | [SpaceCaslAction, SpaceCaslSubject.Settings]
  | [SpaceCaslAction, SpaceCaslSubject.Member]
  | [SpaceCaslAction, SpaceCaslSubject.Page]
  | [SpaceCaslAction, SpaceCaslSubject.Share]
  | [SpaceCaslAction, SpaceCaslSubject.Directory];

export interface ResourcePermission {
  canView: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canShare: boolean;
  canManage: boolean;
  effectiveRole: "admin" | "writer" | "reader" | "none";
  isOverridden: boolean;
}
