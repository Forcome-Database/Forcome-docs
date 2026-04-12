import {
  NodeApi,
  NodeRendererProps,
  Tree,
  TreeApi,
  SimpleTree,
} from "react-arborist";
import { atom, useAtom } from "jotai";
import { treeApiAtom } from "@/features/page/tree/atoms/tree-api-atom.ts";
import {
  fetchAllAncestorChildren,
  useGetRootSidebarPagesQuery,
  usePageQuery,
  useUpdatePageMutation,
} from "@/features/page/queries/page-query.ts";
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import classes from "@/features/page/tree/styles/tree.module.css";
import { ActionIcon, Box, Menu, rem, Text } from "@mantine/core";
import {
  IconArrowRight,
  IconCategory,
  IconChevronDown,
  IconChevronRight,
  IconCopy,
  IconDotsVertical,
  IconEdit,
  IconFileDescription,
  IconFileExport,
  IconFolder,
  IconLink,
  IconLock,
  IconPlus,
  IconPointFilled,
  IconTag,
  IconTrash,
} from "@tabler/icons-react";
import {
  appendNodeChildrenAtom,
  treeDataAtom,
} from "@/features/page/tree/atoms/tree-data-atom.ts";
import clsx from "clsx";
import EmojiPicker from "@/components/ui/emoji-picker.tsx";
import { useTreeMutation } from "@/features/page/tree/hooks/use-tree-mutation.ts";
import {
  appendNodeChildren,
  buildTree,
  buildTreeWithChildren,
  mergeRootTrees,
  sortPositionKeys,
  updateTreeNodeIcon,
} from "@/features/page/tree/utils/utils.ts";
import { SpaceTreeNode } from "@/features/page/tree/types.ts";
import {
  getPageBreadcrumbs,
  getPageById,
  getAllSidebarPages,
  getSidebarPages,
} from "@/features/page/services/page-service.ts";
import { IPage, SidebarPagesParams } from "@/features/page/types/page.types.ts";
import { queryClient } from "@/main.tsx";
import { OpenMap } from "react-arborist/dist/main/state/open-slice";
import {
  useDisclosure,
  useElementSize,
  useMergedRef,
} from "@mantine/hooks";
import { useClipboard } from "@/hooks/use-clipboard";
import { dfs } from "react-arborist/dist/module/utils";
import { useQueryEmit } from "@/features/websocket/use-query-emit.ts";
import { buildPageUrl } from "@/features/page/page.utils.ts";
import { notifications } from "@mantine/notifications";
import { getAppUrl } from "@/lib/config.ts";
import { extractPageSlugId } from "@/lib";
import { useDeletePageModal } from "@/features/page/hooks/use-delete-page-modal.tsx";
import { useTranslation } from "react-i18next";
import ExportModal from "@/components/common/export-modal";
import MovePageModal from "../../components/move-page-modal.tsx";
import { mobileSidebarAtom } from "@/components/layouts/global/hooks/atoms/sidebar-atom.ts";
import { useToggleSidebar } from "@/components/layouts/global/hooks/hooks/use-toggle-sidebar.ts";
import CopyPageModal from "../../components/copy-page-modal.tsx";
import CategorizePageModal from "../../components/categorize-page-modal.tsx";
import { duplicatePage } from "../../services/page-service.ts";
import { useUpdateDirectoryMutation, useGetDirectoriesQuery } from "@/features/directory/queries/directory-query.ts";
import { ResourcePermissionModal } from "@/features/resource-permission/components/resource-permission-modal";
import { getTopics } from "@/features/topic/services/topic-service.ts";
import { IDirectory } from "@/features/directory/types/directory.types.ts";
import { ITopic } from "@/features/topic/types/topic.types.ts";

function directoryToTreeNode(dir: IDirectory): SpaceTreeNode {
  return {
    id: dir.id,
    slugId: dir.slug || '',
    name: dir.name,
    icon: dir.icon,
    position: dir.position || 'a0',
    spaceId: dir.spaceId,
    parentPageId: null,
    hasChildren: true,
    children: [],
    nodeType: 'directory',
    effectiveRole: dir.effectiveRole,
  };
}

function topicToTreeNode(topic: ITopic): SpaceTreeNode {
  return {
    id: topic.id,
    slugId: topic.slug || '',
    name: topic.name,
    icon: topic.icon,
    position: topic.position || 'a0',
    spaceId: topic.spaceId,
    parentPageId: null,
    hasChildren: true,
    children: [],
    nodeType: 'topic',
    directoryId: topic.directoryId,
  };
}

interface SpaceTreeProps {
  spaceId: string;
  readOnly: boolean;
}

const openTreeNodesAtom = atom<OpenMap>({});

export default function SpaceTree({ spaceId, readOnly }: SpaceTreeProps) {
  const { t } = useTranslation();
  const { pageSlug } = useParams();
  const { data, setData, controllers } =
    useTreeMutation<TreeApi<SpaceTreeNode>>(spaceId);
  const {
    data: pagesData,
    hasNextPage,
    fetchNextPage,
    isFetching,
  } = useGetRootSidebarPagesQuery({
    spaceId,
  });
  const { data: dirData } = useGetDirectoriesQuery(spaceId);
  const [, setTreeApi] = useAtom<TreeApi<SpaceTreeNode>>(treeApiAtom);
  const treeApiRef = useRef<TreeApi<SpaceTreeNode>>();
  const [openTreeNodes, setOpenTreeNodes] = useAtom<OpenMap>(openTreeNodesAtom);
  const rootElement = useRef<HTMLDivElement>();
  const [isRootReady, setIsRootReady] = useState(false);
  const { ref: sizeRef, width, height } = useElementSize();
  const mergedRef = useMergedRef((element) => {
    rootElement.current = element;
    if (element && !isRootReady) {
      setIsRootReady(true);
    }
  }, sizeRef);
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  const spaceIdRef = useRef(spaceId);
  spaceIdRef.current = spaceId;
  const { data: currentPage } = usePageQuery({
    pageId: extractPageSlugId(pageSlug),
  });

  useEffect(() => {
    setIsDataLoaded(false);
  }, [spaceId]);

  useEffect(() => {
    if (hasNextPage && !isFetching) {
      fetchNextPage();
    }
  }, [hasNextPage, fetchNextPage, isFetching, spaceId]);

  useEffect(() => {
    if (pagesData?.pages && !hasNextPage) {
      const allItems = pagesData.pages.flatMap((page) => page.items);
      const pageTreeData = buildTree(allItems);

      // Convert directories to tree nodes
      const directories = dirData?.items || [];
      const dirTreeNodes = sortPositionKeys(
        directories.map(directoryToTreeNode)
      );

      // Merge directories and uncategorized pages, sorted by position
      const treeData = sortPositionKeys([...dirTreeNodes, ...pageTreeData]);

      setData((prev) => {
        // fresh space; full reset
        if (prev.length === 0 || prev[0]?.spaceId !== spaceId) {
          setIsDataLoaded(true);
          setOpenTreeNodes({});
          return treeData;
        }

        // same space; append only missing roots
        setIsDataLoaded(true);
        return mergeRootTrees(prev, treeData);
      });
    }
  }, [pagesData, hasNextPage, spaceId, dirData]);

  useEffect(() => {
    const effectSpaceId = spaceId;

    const fetchData = async () => {
      if (isDataLoaded && currentPage) {
        // check if pageId node is present in the tree
        const node = dfs(treeApiRef.current?.root, currentPage.id);
        if (node) {
          // if node is found, no need to traverse its ancestors
          return;
        }

        // if not found, fetch and build its ancestors and their children
        if (!currentPage.id) return;
        const ancestors = await getPageBreadcrumbs(currentPage.id);

        if (spaceIdRef.current !== effectSpaceId) return;

        if (ancestors && ancestors?.length > 1) {
          let flatTreeItems = [...buildTree(ancestors)];

          const fetchAndUpdateChildren = async (ancestor: IPage) => {
            // we don't want to fetch the children of the opened page
            if (ancestor.id === currentPage.id) {
              return;
            }
            const children = await fetchAllAncestorChildren({
              pageId: ancestor.id,
              spaceId: ancestor.spaceId,
            });

            flatTreeItems = [
              ...flatTreeItems,
              ...children.filter(
                (child) => !flatTreeItems.some((item) => item.id === child.id),
              ),
            ];
          };

          const fetchPromises = ancestors.map((ancestor) =>
            fetchAndUpdateChildren(ancestor),
          );

          // Wait for all fetch operations to complete
          Promise.all(fetchPromises).then(() => {
            if (spaceIdRef.current !== effectSpaceId) return;

            // build tree with children
            const ancestorsTree = buildTreeWithChildren(flatTreeItems);
            // child of root page we're attaching the built ancestors to
            const rootChild = ancestorsTree[0];

            // attach built ancestors to tree using functional updater
            // to avoid stale closure overwriting the current tree data
            setData((currentData) =>
              appendNodeChildren(currentData, rootChild.id, rootChild.children),
            );

            setTimeout(() => {
              // focus on node and open all parents
              treeApiRef.current?.select(currentPage.id);
            }, 100);
          });
        }
      }
    };

    fetchData();
  }, [isDataLoaded, currentPage?.id]);

  useEffect(() => {
    if (currentPage?.id) {
      setTimeout(() => {
        // focus on node and open all parents
        treeApiRef.current?.select(currentPage.id, { align: "auto" });
      }, 200);
    } else {
      treeApiRef.current?.deselectAll();
    }
  }, [currentPage?.id]);

  // Clean up tree API on unmount
  useEffect(() => {
    return () => {
      // @ts-ignore
      setTreeApi(null);
    };
  }, [setTreeApi]);

  const filteredData = data.filter((node) => node?.spaceId === spaceId);

  return (
    <div ref={mergedRef} className={classes.treeContainer}>
      {isDataLoaded && filteredData.length === 0 && (
        <Text size="xs" c="dimmed" py="xs" px="sm">
          {t("No pages yet")}
        </Text>
      )}
      {isRootReady && rootElement.current && (
        <Tree
          data={filteredData}
          disableDrag={readOnly}
          disableDrop={readOnly}
          disableEdit={readOnly}
          {...controllers}
          width={width}
          height={rootElement.current.clientHeight}
          ref={(ref) => {
            treeApiRef.current = ref;
            if (ref) {
              //@ts-ignore
              setTreeApi(ref);
            }
          }}
          openByDefault={false}
          disableMultiSelection={true}
          className={classes.tree}
          rowClassName={classes.row}
          rowHeight={30}
          overscanCount={10}
          dndRootElement={rootElement.current}
          onToggle={() => {
            setOpenTreeNodes(treeApiRef.current?.openState);
          }}
          initialOpenState={openTreeNodes}
        >
          {Node}
        </Tree>
      )}
    </div>
  );
}

function Node({ node, style, dragHandle, tree }: NodeRendererProps<any>) {
  const { t } = useTranslation();
  const updatePageMutation = useUpdatePageMutation();
  const [treeData, setTreeData] = useAtom(treeDataAtom);
  const [, appendChildren] = useAtom(appendNodeChildrenAtom);
  const emit = useQueryEmit();
  const { spaceSlug } = useParams();
  const timerRef = useRef(null);
  const isLoadingChildrenRef = useRef(false);
  const [mobileSidebarOpened] = useAtom(mobileSidebarAtom);
  const toggleMobileSidebar = useToggleSidebar(mobileSidebarAtom);

  const prefetchPage = () => {
    timerRef.current = setTimeout(async () => {
      const page = await queryClient.fetchQuery({
        queryKey: ["pages", node.data.id],
        queryFn: () => getPageById({ pageId: node.data.id }),
        staleTime: 5 * 60 * 1000,
      });
      if (page?.slugId) {
        queryClient.setQueryData(["pages", page.slugId], page);
      }
    }, 150);
  };

  const cancelPagePrefetch = () => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  async function handleLoadChildren(node: NodeApi<SpaceTreeNode>) {
    if (!node.data.hasChildren) return;
    if (node.children?.length > 0) return; // Already loaded
    if (isLoadingChildrenRef.current) return; // Already loading
    isLoadingChildrenRef.current = true;

    const nodeType = node.data.nodeType;

    try {
      if (nodeType === 'directory') {
        // Fetch topics for this directory
        const topicsResult = await getTopics(node.data.id);
        const topicNodes = sortPositionKeys(
          (topicsResult?.items || []).map(topicToTreeNode)
        );

        // Fetch direct pages under this directory (no topic)
        const pagesResult = await getAllSidebarPages({
          spaceId: node.data.spaceId,
          directoryId: node.data.id,
        });
        const allPages = pagesResult.pages.flatMap((p) => p.items);
        // Filter pages that have no topicId (direct children of directory)
        const directPages = allPages.filter((page) => !page.topicId);
        const pageNodes = buildTree(directPages);

        // Merge: topics first, then direct pages
        const children = [...topicNodes, ...pageNodes];

        appendChildren({
          parentId: node.data.id,
          children,
        });
      } else if (nodeType === 'topic') {
        // Fetch pages under this topic
        const pagesResult = await getAllSidebarPages({
          spaceId: node.data.spaceId,
          topicId: node.data.id,
        });
        const allPages = pagesResult.pages.flatMap((p) => p.items);
        const pageNodes = buildTree(allPages);

        appendChildren({
          parentId: node.data.id,
          children: pageNodes,
        });
      } else {
        // Default: page node - existing logic
        const params: SidebarPagesParams = {
          pageId: node.data.id,
          spaceId: node.data.spaceId,
        };

        const childrenTree = await fetchAllAncestorChildren(params);

        appendChildren({
          parentId: node.data.id,
          children: childrenTree,
        });
      }
    } catch (error) {
      console.error("Failed to fetch children:", error);
    } finally {
      isLoadingChildrenRef.current = false;
    }
  }

  // Auto-load children when node is opened (e.g., via openAll) but children not yet loaded
  useEffect(() => {
    if (node.isOpen && node.data.hasChildren && node.children?.length === 0) {
      handleLoadChildren(node);
    }
  }, [node.isOpen]);

  const handleUpdateNodeIcon = (nodeId: string, newIcon: string) => {
    const updatedTree = updateTreeNodeIcon(treeData, nodeId, newIcon);
    setTreeData(updatedTree);
  };

  const handleEmojiIconClick = (e: any) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleEmojiSelect = (emoji: { native: string }) => {
    handleUpdateNodeIcon(node.id, emoji.native);
    updatePageMutation
      .mutateAsync({ pageId: node.id, icon: emoji.native })
      .then((data) => {
        setTimeout(() => {
          emit({
            operation: "updateOne",
            spaceId: node.data.spaceId,
            entity: ["pages"],
            id: node.id,
            payload: { icon: emoji.native, parentPageId: data.parentPageId },
          });
        }, 50);
      });
  };

  const handleRemoveEmoji = () => {
    handleUpdateNodeIcon(node.id, null);
    updatePageMutation.mutateAsync({ pageId: node.id, icon: null });

    setTimeout(() => {
      emit({
        operation: "updateOne",
        spaceId: node.data.spaceId,
        entity: ["pages"],
        id: node.id,
        payload: { icon: null },
      });
    }, 50);
  };

  if (
    node.willReceiveDrop &&
    node.isClosed &&
    (node.children.length > 0 || node.data.hasChildren)
  ) {
    handleLoadChildren(node);
    setTimeout(() => {
      if (node.state.willReceiveDrop) {
        node.open();
      }
    }, 650);
  }

  const nodeType = node.data.nodeType;

  // Directory and Topic nodes: no navigation, click toggles expand
  if (nodeType === 'directory' || nodeType === 'topic') {
    // For directory/topic nodes, allow creation if the user has write access
    // via resource-level override, even when the global tree is readOnly.
    // Directory nodes carry effectiveRole from the API; topic nodes inherit
    // from their parent directory node.
    const nodeRole = nodeType === 'directory'
      ? node.data.effectiveRole
      : (node.parent?.data as SpaceTreeNode)?.effectiveRole;
    const canCreateInNode = !tree.props.disableEdit
      || nodeRole === 'admin' || nodeRole === 'writer';

    return (
      <DirectoryNode
        node={node}
        tree={tree}
        style={style}
        dragHandle={dragHandle}
        nodeType={nodeType}
        nodeRole={nodeRole}
        canCreateInNode={canCreateInNode}
        onLoadChildren={() => handleLoadChildren(node)}
        t={t}
      />
    );
  }

  // Page nodes: full behavior with navigation, emoji picker, node menu
  const pageUrl = buildPageUrl(spaceSlug, node.data.slugId, node.data.name);

  // Determine if this page is editable: either via global space permission,
  // or via directory-level override (find the directory ancestor's effectiveRole).
  const dirNode = node.data.directoryId
    ? treeData.find((n) => n.id === node.data.directoryId)
    : undefined;
  const dirRole = dirNode?.effectiveRole;
  const pageCanEdit = !tree.props.disableEdit
    || dirRole === 'admin' || dirRole === 'writer';

  return (
    <>
      <Box
        style={style}
        className={clsx(classes.node, node.state)}
        component={Link}
        to={pageUrl}
        // @ts-ignore
        ref={dragHandle}
        onClick={() => {
          if (mobileSidebarOpened) {
            toggleMobileSidebar();
          }
        }}
        onMouseEnter={prefetchPage}
        onMouseLeave={cancelPagePrefetch}
      >
        <PageArrow node={node} onExpandTree={() => handleLoadChildren(node)} />

        <div onClick={handleEmojiIconClick} style={{ marginRight: "4px" }}>
          <EmojiPicker
            onEmojiSelect={handleEmojiSelect}
            icon={
              node.data.icon ? (
                node.data.icon
              ) : (
                <IconFileDescription size="18" />
              )
            }
            readOnly={!pageCanEdit}
            removeEmojiAction={handleRemoveEmoji}
          />
        </div>

        <span className={classes.text}>{node.data.name || t("untitled")}</span>

        <div className={classes.actions}>
          <NodeMenu node={node} treeApi={tree} spaceId={node.data.spaceId} canEdit={pageCanEdit} />

          {pageCanEdit && (
            <CreateNode
              node={node}
              treeApi={tree}
              onExpandTree={() => handleLoadChildren(node)}
            />
          )}
        </div>
      </Box>
    </>
  );
}

interface CreateNodeProps {
  node: NodeApi<SpaceTreeNode>;
  treeApi: TreeApi<SpaceTreeNode>;
  onExpandTree?: () => void;
}

function CreateNode({ node, treeApi, onExpandTree }: CreateNodeProps) {
  function handleCreate() {
    if (node.data.hasChildren && node.children.length === 0) {
      node.toggle();
      onExpandTree();

      setTimeout(() => {
        treeApi?.create({ type: "internal", parentId: node.id, index: 0 });
      }, 500);
    } else {
      treeApi?.create({ type: "internal", parentId: node.id });
    }
  }

  return (
    <ActionIcon
      variant="transparent"
      c="gray"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        handleCreate();
      }}
    >
      <IconPlus style={{ width: rem(20), height: rem(20) }} stroke={2} />
    </ActionIcon>
  );
}

interface NodeMenuProps {
  node: NodeApi<SpaceTreeNode>;
  treeApi: TreeApi<SpaceTreeNode>;
  spaceId: string;
  canEdit?: boolean;
}

function NodeMenu({ node, treeApi, spaceId, canEdit }: NodeMenuProps) {
  const { t } = useTranslation();
  const clipboard = useClipboard({ timeout: 500 });
  const { spaceSlug } = useParams();
  const { openDeleteModal } = useDeletePageModal();
  const [data, setData] = useAtom(treeDataAtom);
  const emit = useQueryEmit();
  const [exportOpened, { open: openExportModal, close: closeExportModal }] =
    useDisclosure(false);
  const [
    movePageModalOpened,
    { open: openMovePageModal, close: closeMoveSpaceModal },
  ] = useDisclosure(false);
  const [
    copyPageModalOpened,
    { open: openCopyPageModal, close: closeCopySpaceModal },
  ] = useDisclosure(false);
  const [
    categorizeModalOpened,
    { open: openCategorizeModal, close: closeCategorizeModal },
  ] = useDisclosure(false);

  const handleCopyLink = () => {
    const pageUrl =
      getAppUrl() + buildPageUrl(spaceSlug, node.data.slugId, node.data.name);
    clipboard.copy(pageUrl);
    notifications.show({ message: t("Link copied") });
  };

  const handleDuplicatePage = async () => {
    try {
      const duplicatedPage = await duplicatePage({
        pageId: node.id,
      });

      // Find the index of the current node
      const parentId =
        node.parent?.id === "__REACT_ARBORIST_INTERNAL_ROOT__"
          ? null
          : node.parent?.id;
      const siblings = parentId ? node.parent.children : treeApi?.props.data;
      const currentIndex =
        siblings?.findIndex((sibling) => sibling.id === node.id) || 0;
      const newIndex = currentIndex + 1;

      // Add the duplicated page to the tree
      const treeNodeData: SpaceTreeNode = {
        id: duplicatedPage.id,
        slugId: duplicatedPage.slugId,
        name: duplicatedPage.title,
        position: duplicatedPage.position,
        spaceId: duplicatedPage.spaceId,
        parentPageId: duplicatedPage.parentPageId,
        icon: duplicatedPage.icon,
        hasChildren: duplicatedPage.hasChildren,
        children: [],
      };

      // Update local tree
      const simpleTree = new SimpleTree(data);
      simpleTree.create({
        parentId,
        index: newIndex,
        data: treeNodeData,
      });
      setData(simpleTree.data);

      // Emit socket event
      setTimeout(() => {
        emit({
          operation: "addTreeNode",
          spaceId: spaceId,
          payload: {
            parentId,
            index: newIndex,
            data: treeNodeData,
          },
        });
      }, 50);

      notifications.show({
        message: t("Page duplicated successfully"),
      });
    } catch (err) {
      notifications.show({
        message: err.response?.data.message || "An error occurred",
        color: "red",
      });
    }
  };

  return (
    <>
      <Menu shadow="md" width={200}>
        <Menu.Target>
          <ActionIcon
            variant="transparent"
            c="gray"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            <IconDotsVertical
              style={{ width: rem(20), height: rem(20) }}
              stroke={2}
            />
          </ActionIcon>
        </Menu.Target>

        <Menu.Dropdown>
          <Menu.Item
            leftSection={<IconLink size={16} />}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleCopyLink();
            }}
          >
            {t("Copy link")}
          </Menu.Item>

          <Menu.Item
            leftSection={<IconFileExport size={16} />}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              openExportModal();
            }}
          >
            {t("Export page")}
          </Menu.Item>

          {canEdit && (
            <>
              <Menu.Item
                leftSection={<IconCopy size={16} />}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleDuplicatePage();
                }}
              >
                {t("Duplicate")}
              </Menu.Item>

              <Menu.Item
                leftSection={<IconArrowRight size={16} />}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  openMovePageModal();
                }}
              >
                {t("Move")}
              </Menu.Item>

              <Menu.Item
                leftSection={<IconCopy size={16} />}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  openCopyPageModal();
                }}
              >
                {t("Copy to space")}
              </Menu.Item>

              <Menu.Item
                leftSection={<IconCategory size={16} />}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  openCategorizeModal();
                }}
              >
                {t("Categorize")}
              </Menu.Item>

              <Menu.Divider />
              <Menu.Item
                c="red"
                leftSection={<IconTrash size={16} />}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  openDeleteModal({ onConfirm: () => treeApi?.delete(node) });
                }}
              >
                {t("Move to trash")}
              </Menu.Item>
            </>
          )}
        </Menu.Dropdown>
      </Menu>

      <MovePageModal
        pageId={node.id}
        slugId={node.data.slugId}
        currentSpaceSlug={spaceSlug}
        onClose={closeMoveSpaceModal}
        open={movePageModalOpened}
      />

      <CopyPageModal
        pageId={node.id}
        currentSpaceSlug={spaceSlug}
        onClose={closeCopySpaceModal}
        open={copyPageModalOpened}
      />

      <CategorizePageModal
        pageId={node.id}
        spaceId={spaceId}
        currentDirectoryId={node.data.directoryId}
        currentTopicId={node.data.topicId}
        open={categorizeModalOpened}
        onClose={closeCategorizeModal}
      />

      <ExportModal
        type="page"
        id={node.id}
        open={exportOpened}
        onClose={closeExportModal}
      />
    </>
  );
}

interface DirectoryNodeProps {
  node: NodeApi<SpaceTreeNode>;
  tree: TreeApi<SpaceTreeNode>;
  style: React.CSSProperties;
  dragHandle: any;
  nodeType: string;
  nodeRole: string | undefined;
  canCreateInNode: boolean;
  onLoadChildren: () => void;
  t: (key: string) => string;
}

function DirectoryNode({
  node, tree, style, dragHandle, nodeType, nodeRole, canCreateInNode, onLoadChildren, t,
}: DirectoryNodeProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(node.data.name);
  const updateDirectoryMutation = useUpdateDirectoryMutation();
  const [, setTreeData] = useAtom(treeDataAtom);
  const [
    permissionOpened,
    { open: openPermission, close: closePermission },
  ] = useDisclosure(false);

  const canEdit = nodeRole === "admin" || nodeRole === "writer";
  const canManagePermissions = nodeRole === "admin";

  const handleRename = async () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === node.data.name) {
      setName(node.data.name);
      setIsEditing(false);
      return;
    }
    try {
      await updateDirectoryMutation.mutateAsync({
        directoryId: node.data.id,
        name: trimmed,
      });
      setTreeData((prev) =>
        prev.map((n) => (n.id === node.data.id ? { ...n, name: trimmed } : n)),
      );
      setIsEditing(false);
    } catch (err) {
      notifications.show({
        message: err.response?.data?.message || "Failed to rename",
        color: "red",
      });
      setName(node.data.name);
      setIsEditing(false);
    }
  };

  return (
    <>
      <Box
        style={style}
        className={clsx(classes.node, node.state)}
        // @ts-ignore
        ref={dragHandle}
        onClick={() => {
          if (!isEditing) {
            node.toggle();
            onLoadChildren();
          }
        }}
      >
        <PageArrow node={node} onExpandTree={onLoadChildren} />

        <ActionIcon
          variant="transparent"
          c="gray"
          style={{ marginRight: "4px" }}
        >
          {node.data.icon ? (
            node.data.icon
          ) : nodeType === 'directory' ? (
            <IconFolder size={18} />
          ) : (
            <IconTag size={18} />
          )}
        </ActionIcon>

        {isEditing ? (
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={handleRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRename();
              if (e.key === "Escape") {
                setName(node.data.name);
                setIsEditing(false);
              }
            }}
            onClick={(e) => e.stopPropagation()}
            className={classes.text}
            style={{
              border: "1px solid var(--mantine-color-blue-5)",
              borderRadius: 4,
              padding: "1px 4px",
              fontSize: "inherit",
              fontFamily: "inherit",
              outline: "none",
              minWidth: 0,
              flex: 1,
            }}
          />
        ) : (
          <span className={classes.text}>{node.data.name || t("untitled")}</span>
        )}

        <div className={classes.actions}>
          {nodeType === 'directory' && (canEdit || canManagePermissions) && (
            <Menu shadow="md" width={200}>
              <Menu.Target>
                <ActionIcon
                  variant="transparent"
                  c="gray"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                >
                  <IconDotsVertical
                    style={{ width: rem(20), height: rem(20) }}
                    stroke={2}
                  />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                {canEdit && (
                  <Menu.Item
                    leftSection={<IconEdit size={16} />}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setName(node.data.name);
                      setIsEditing(true);
                    }}
                  >
                    {t("Rename")}
                  </Menu.Item>
                )}
                {canManagePermissions && (
                  <Menu.Item
                    leftSection={<IconLock size={16} />}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      openPermission();
                    }}
                  >
                    {t("Permissions")}
                  </Menu.Item>
                )}
              </Menu.Dropdown>
            </Menu>
          )}
          {canCreateInNode && (
            <CreateNode
              node={node}
              treeApi={tree}
              onExpandTree={onLoadChildren}
            />
          )}
        </div>
      </Box>

      <ResourcePermissionModal
        resourceId={node.data.id}
        resourceType="directory"
        resourceName={node.data.name}
        opened={permissionOpened}
        onClose={closePermission}
      />
    </>
  );
}

interface PageArrowProps {
  node: NodeApi<SpaceTreeNode>;
  onExpandTree?: () => void;
}

function PageArrow({ node, onExpandTree }: PageArrowProps) {
  useEffect(() => {
    if (node.isOpen) {
      onExpandTree();
    }
  }, []);

  return (
    <ActionIcon
      size={20}
      variant="subtle"
      c="gray"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        node.toggle();
        onExpandTree();
      }}
    >
      {node.isInternal ? (
        node.children && (node.children.length > 0 || node.data.hasChildren) ? (
          node.isOpen ? (
            <IconChevronDown stroke={2} size={18} />
          ) : (
            <IconChevronRight stroke={2} size={18} />
          )
        ) : (
          <IconPointFilled size={8} />
        )
      ) : null}
    </ActionIcon>
  );
}
