import { useMemo } from "react";
import {
  CreateHandler,
  DeleteHandler,
  MoveHandler,
  NodeApi,
  RenameHandler,
  SimpleTree,
} from "react-arborist";
import { useAtom } from "jotai";
import { treeDataAtom } from "@/features/page/tree/atoms/tree-data-atom.ts";
import { IMovePage, IPage } from "@/features/page/types/page.types.ts";
import { useNavigate, useParams } from "react-router-dom";
import {
  useCreatePageMutation,
  useRemovePageMutation,
  useMovePageMutation,
  useUpdatePageMutation,
  updateCacheOnMovePage,
  invalidateDirectoryTopicQueries,
} from "@/features/page/queries/page-query.ts";
import { queryClient } from "@/main";
import { generateJitteredKeyBetween } from "fractional-indexing-jittered";
import { SpaceTreeNode } from "@/features/page/tree/types.ts";
import { buildPageUrl } from "@/features/page/page.utils.ts";
import { getSpaceUrl } from "@/lib/config.ts";
import { useQueryEmit } from "@/features/websocket/use-query-emit.ts";

export function useTreeMutation<T>(spaceId: string) {
  const [data, setData] = useAtom(treeDataAtom);
  const tree = useMemo(() => new SimpleTree<SpaceTreeNode>(data), [data]);
  const createPageMutation = useCreatePageMutation();
  const updatePageMutation = useUpdatePageMutation();
  const removePageMutation = useRemovePageMutation();
  const movePageMutation = useMovePageMutation();
  const navigate = useNavigate();
  const { spaceSlug } = useParams();
  const { pageSlug } = useParams();
  const emit = useQueryEmit();

  const onCreate: CreateHandler<T> = async ({ parentId, index, type }) => {
    const payload: { spaceId: string; parentPageId?: string; directoryId?: string; topicId?: string } = {
      spaceId: spaceId,
    };

    if (parentId) {
      const parentNode = tree.find(parentId);
      const parentNodeType = (parentNode?.data as SpaceTreeNode)?.nodeType;

      if (parentNodeType === 'directory') {
        payload.directoryId = parentId;
        // Don't set parentPageId - the page is at root level in page hierarchy
      } else if (parentNodeType === 'topic') {
        payload.directoryId = (parentNode.data as SpaceTreeNode).directoryId;
        payload.topicId = parentId;
        // Don't set parentPageId
      } else {
        payload.parentPageId = parentId;
      }
    }

    let createdPage: IPage;
    try {
      createdPage = await createPageMutation.mutateAsync(payload);
    } catch (err) {
      throw new Error("Failed to create page");
    }

    const data = {
      id: createdPage.id,
      slugId: createdPage.slugId,
      name: "",
      position: createdPage.position,
      spaceId: createdPage.spaceId,
      parentPageId: createdPage.parentPageId,
      children: [],
    } as any;

    let lastIndex: number;
    if (parentId === null) {
      lastIndex = tree.data.length;
    } else {
      lastIndex = tree.find(parentId).children.length;
    }
    // to place the newly created node at the bottom
    index = lastIndex;

    tree.create({ parentId, index, data });
    setData(tree.data);

    setTimeout(() => {
      emit({
        operation: "addTreeNode",
        spaceId: spaceId,
        payload: {
          parentId,
          index,
          data,
        },
      });
    }, 50);

    const pageUrl = buildPageUrl(
      spaceSlug,
      createdPage.slugId,
      createdPage.title
    );
    navigate(pageUrl);
    return data;
  };

  const onMove: MoveHandler<T> = async (args: {
    dragIds: string[];
    dragNodes: NodeApi<T>[];
    parentId: string | null;
    parentNode: NodeApi<T> | null;
    index: number;
  }) => {
    const draggedNodeType = (args.dragNodes[0].data as SpaceTreeNode)?.nodeType;
    // Don't allow moving directory or topic nodes
    if (draggedNodeType === 'directory' || draggedNodeType === 'topic') {
      return;
    }

    const draggedNodeId = args.dragIds[0];

    tree.move({
      id: draggedNodeId,
      parentId: args.parentId,
      index: args.index,
    });

    const newDragIndex = tree.find(draggedNodeId)?.childIndex;

    const currentTreeData = args.parentId
      ? tree.find(args.parentId).children
      : tree.data;

    // if there is a parentId, tree.find(args.parentId).children returns a SimpleNode array
    // we have to access the node differently via currentTreeData[args.index]?.data?.position
    // this makes it possible to correctly sort children of a parent node that is not the root

    const afterPosition =
      // @ts-ignore
      currentTreeData[newDragIndex - 1]?.position ||
      // @ts-ignore
      currentTreeData[args.index - 1]?.data?.position ||
      null;

    const beforePosition =
      // @ts-ignore
      currentTreeData[newDragIndex + 1]?.position ||
      // @ts-ignore
      currentTreeData[args.index + 1]?.data?.position ||
      null;

    let newPosition: string;

    if (afterPosition && beforePosition && afterPosition === beforePosition) {
      // if after is equal to before, put it next to the after node
      newPosition = generateJitteredKeyBetween(afterPosition, null);
    } else {
      // if both are null then, it is the first index
      newPosition = generateJitteredKeyBetween(afterPosition, beforePosition);
    }

    // update the node position in tree
    tree.update({
      id: draggedNodeId,
      changes: { position: newPosition } as any,
    });

    const previousParent = args.dragNodes[0].parent;
    if (
      previousParent.id !== args.parentId &&
      previousParent.id !== "__REACT_ARBORIST_INTERNAL_ROOT__"
    ) {
      // if the page was moved to another parent,
      // check if the previous still has children
      // if no children left, change 'hasChildren' to false, to make the page toggle arrows work properly
      const childrenCount = previousParent.children.filter(
        (child) => child.id !== draggedNodeId
      ).length;
      if (childrenCount === 0) {
        tree.update({
          id: previousParent.id,
          changes: { ...previousParent.data, hasChildren: false } as any,
        });
      }
    }

    setData(tree.data);

    const draggedNode = args.dragNodes[0];
    const nodeData = draggedNode.data as SpaceTreeNode;
    const oldParentId = nodeData.parentPageId ?? null;

    // Detect old directory/topic from tree node data, or infer from parent node type
    const previousParentData = (args.dragNodes[0].parent?.data as SpaceTreeNode) ?? undefined;
    const previousParentType = previousParentData?.nodeType;
    let oldDirectoryId: string | null = nodeData.directoryId ?? null;
    let oldTopicId: string | null = nodeData.topicId ?? null;
    if (!oldDirectoryId && !oldTopicId) {
      // Fallback: infer from parent node in tree
      if (previousParentType === "directory") {
        oldDirectoryId = args.dragNodes[0].parent.id;
      } else if (previousParentType === "topic") {
        oldDirectoryId = previousParentData?.directoryId ?? null;
        oldTopicId = args.dragNodes[0].parent.id;
      }
    }

    // Determine actual parentPageId, directoryId, topicId based on drop target type
    const parentNodeData = args.parentNode?.data as SpaceTreeNode | undefined;
    const parentNodeType = parentNodeData?.nodeType;

    let actualParentPageId: string | null = args.parentId;
    let newDirectoryId: string | null = null;
    let newTopicId: string | null = null;

    if (parentNodeType === "directory") {
      // Dropped on a directory node: categorize under this directory
      actualParentPageId = null;
      newDirectoryId = args.parentId;
      newTopicId = null;
    } else if (parentNodeType === "topic") {
      // Dropped on a topic node: categorize under this topic (and its parent directory)
      actualParentPageId = null;
      newDirectoryId = parentNodeData?.directoryId ?? null;
      newTopicId = args.parentId;
    } else {
      // Dropped on a regular page or root: clear directory/topic categorization
      newDirectoryId = null;
      newTopicId = null;
    }

    const payload: IMovePage = {
      pageId: draggedNodeId,
      position: newPosition,
      parentPageId: actualParentPageId,
      directoryId: newDirectoryId,
      topicId: newTopicId,
    };

    const pageData = {
      id: nodeData.id,
      slugId: nodeData.slugId,
      title: nodeData.name,
      icon: nodeData.icon,
      position: newPosition,
      spaceId: nodeData.spaceId,
      parentPageId: actualParentPageId,
      hasChildren: nodeData.hasChildren,
    };

    const wasInDirectory = !!oldDirectoryId || !!oldTopicId;
    const isNowInDirectory = !!newDirectoryId || !!newTopicId;

    try {
      await movePageMutation.mutateAsync(payload);

      if (!wasInDirectory && !isNowInDirectory) {
        // Normal sidebar-to-sidebar move
        updateCacheOnMovePage(spaceId, draggedNodeId, oldParentId, actualParentPageId, pageData);
      } else {
        // Involves directory/topic: handle cache invalidation carefully
        if (!wasInDirectory) {
          // Was in sidebar → now in dir/topic: invalidate old sidebar cache
          if (oldParentId === null) {
            queryClient.invalidateQueries({ queryKey: ["root-sidebar-pages", spaceId] });
          } else {
            queryClient.invalidateQueries({ queryKey: ["sidebar-pages", { pageId: oldParentId, spaceId }] });
          }
        }
        if (!isNowInDirectory) {
          // Was in dir/topic → now in sidebar: invalidate new sidebar cache
          if (actualParentPageId === null) {
            queryClient.invalidateQueries({ queryKey: ["root-sidebar-pages", spaceId] });
          } else {
            queryClient.invalidateQueries({ queryKey: ["sidebar-pages", { pageId: actualParentPageId, spaceId }] });
          }
        }
        // Invalidate old directory/topic caches
        if (oldDirectoryId || oldTopicId) {
          invalidateDirectoryTopicQueries(spaceId, oldDirectoryId, oldTopicId);
        }
        // Invalidate new directory/topic caches
        if (newDirectoryId || newTopicId) {
          invalidateDirectoryTopicQueries(spaceId, newDirectoryId, newTopicId);
        }
      }

      setTimeout(() => {
        emit({
          operation: "moveTreeNode",
          spaceId: spaceId,
          payload: {
            id: draggedNodeId,
            parentId: args.parentId,
            oldParentId,
            index: args.index,
            position: newPosition,
            pageData,
          },
        });
      }, 50);
    } catch (error) {
      console.error("Error moving page:", error);
    }
  };

  const onRename: RenameHandler<T> = ({ name, id }) => {
    tree.update({ id, changes: { name } as any });
    setData(tree.data);

    try {
      updatePageMutation.mutateAsync({ pageId: id, title: name });
    } catch (error) {
      console.error("Error updating page title:", error);
    }
  };

  const isPageInNode = (
    node: { data: SpaceTreeNode; children?: any[] },
    pageSlug: string
  ): boolean => {
    if (node.data.slugId === pageSlug) {
      return true;
    }
    for (const item of node.children) {
      if (item.data.slugId === pageSlug) {
        return true;
      } else {
        return isPageInNode(item, pageSlug);
      }
    }
    return false;
  };

  const onDelete: DeleteHandler<T> = async (args: { ids: string[] }) => {
    try {
      await removePageMutation.mutateAsync(args.ids[0]);

      const node = tree.find(args.ids[0]);
      if (!node) {
        return;
      }

      tree.drop({ id: args.ids[0] });
      setData(tree.data);

      if (pageSlug && isPageInNode(node, pageSlug.split("-")[1])) {
        navigate(getSpaceUrl(spaceSlug));
      }

      setTimeout(() => {
        emit({
          operation: "deleteTreeNode",
          spaceId: spaceId,
          payload: { node: node.data },
        });
      }, 50);
    } catch (error) {
      console.error("Failed to delete page:", error);
    }
  };

  const controllers = { onMove, onRename, onCreate, onDelete };
  return { data, setData, controllers } as const;
}
