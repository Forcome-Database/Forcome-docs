export type SpaceTreeNode = {
  id: string;
  slugId: string;
  name: string;
  icon?: string;
  position: string;
  spaceId: string;
  parentPageId: string;
  hasChildren: boolean;
  children: SpaceTreeNode[];
  nodeType?: "directory" | "topic" | "page";
  directoryId?: string;
  topicId?: string;
};
