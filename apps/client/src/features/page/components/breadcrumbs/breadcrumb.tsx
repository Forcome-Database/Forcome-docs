import { useAtomValue } from "jotai";
import { treeDataAtom } from "@/features/page/tree/atoms/tree-data-atom.ts";
import React, { useCallback, useEffect, useState } from "react";
import { findBreadcrumbPath } from "@/features/page/tree/utils";
import {
  Button,
  Anchor,
  Popover,
  Breadcrumbs,
  ActionIcon,
  Text,
  Tooltip,
  Group,
} from "@mantine/core";
import { IconCornerDownRightDouble, IconDots, IconFolder, IconTag } from "@tabler/icons-react";
import { Link, useParams } from "react-router-dom";
import classes from "./breadcrumb.module.css";
import { SpaceTreeNode } from "@/features/page/tree/types.ts";
import { buildPageUrl } from "@/features/page/page.utils.ts";
import { usePageQuery } from "@/features/page/queries/page-query.ts";
import { extractPageSlugId } from "@/lib";
import { useMediaQuery } from "@mantine/hooks";
import { useDirectoryQuery } from "@/features/directory/queries/directory-query.ts";
import { useTopicQuery } from "@/features/topic/queries/topic-query.ts";

function getTitle(name: string, icon: string) {
  if (icon) {
    return `${icon} ${name}`;
  }
  return name;
}

export default function Breadcrumb() {
  const treeData = useAtomValue(treeDataAtom);
  const [breadcrumbNodes, setBreadcrumbNodes] = useState<
    SpaceTreeNode[] | null
  >(null);
  const { pageSlug, spaceSlug } = useParams();
  const { data: currentPage } = usePageQuery({
    pageId: extractPageSlugId(pageSlug),
  });
  const isMobile = useMediaQuery("(max-width: 48em)");

  // Fetch directory/topic info for prefix breadcrumbs
  const directoryId = currentPage?.directoryId;
  const topicId = currentPage?.topicId;
  const { data: directory } = useDirectoryQuery(directoryId || "");
  const { data: topic } = useTopicQuery(topicId || "");

  useEffect(() => {
    if (treeData?.length > 0 && currentPage) {
      const breadcrumb = findBreadcrumbPath(treeData, currentPage.id);
      setBreadcrumbNodes(breadcrumb || null);
    }
  }, [currentPage?.id, treeData]);

  const HiddenNodesTooltipContent = () =>
    breadcrumbNodes?.slice(1, -1).map((node) => (
      <Button.Group orientation="vertical" key={node.id}>
        <Button
          justify="start"
          component={Link}
          to={buildPageUrl(spaceSlug, node.slugId, node.name)}
          variant="default"
          style={{ border: "none" }}
        >
          <Text fz={"sm"} className={classes.truncatedText}>
            {getTitle(node.name, node.icon)}
          </Text>
        </Button>
      </Button.Group>
    ));

  const MobileHiddenNodesTooltipContent = () => (
    <>
      {directory && (
        <Button.Group orientation="vertical" key="mobile-dir-prefix">
          <Button
            justify="start"
            variant="default"
            style={{ border: "none", cursor: "default" }}
            disabled
          >
            <Group gap={4} wrap="nowrap">
              <IconFolder size={14} style={{ flexShrink: 0 }} />
              <Text fz="sm" c="dimmed" className={classes.truncatedText}>
                {directory.icon ? `${directory.icon} ${directory.name}` : directory.name}
              </Text>
            </Group>
          </Button>
        </Button.Group>
      )}
      {topic && (
        <Button.Group orientation="vertical" key="mobile-topic-prefix">
          <Button
            justify="start"
            variant="default"
            style={{ border: "none", cursor: "default" }}
            disabled
          >
            <Group gap={4} wrap="nowrap">
              <IconTag size={14} style={{ flexShrink: 0 }} />
              <Text fz="sm" c="dimmed" className={classes.truncatedText}>
                {topic.icon ? `${topic.icon} ${topic.name}` : topic.name}
              </Text>
            </Group>
          </Button>
        </Button.Group>
      )}
      {breadcrumbNodes?.map((node) => (
        <Button.Group orientation="vertical" key={node.id}>
          <Button
            justify="start"
            component={Link}
            to={buildPageUrl(spaceSlug, node.slugId, node.name)}
            variant="default"
            style={{ border: "none" }}
          >
            <Text fz={"sm"} className={classes.truncatedText}>
              {getTitle(node.name, node.icon)}
            </Text>
          </Button>
        </Button.Group>
      ))}
    </>
  );

  const renderAnchor = useCallback(
    (node: SpaceTreeNode) => (
      <Tooltip label={node.name} key={node.id}>
        <Anchor
          component={Link}
          to={buildPageUrl(spaceSlug, node.slugId, node.name)}
          underline="never"
          fz="sm"
          key={node.id}
          className={classes.truncatedText}
        >
          {getTitle(node.name, node.icon)}
        </Anchor>
      </Tooltip>
    ),
    [spaceSlug],
  );

  const getPrefixItems = () => {
    const items: React.ReactNode[] = [];
    if (directory) {
      items.push(
        <Tooltip label={directory.name} key="dir-prefix">
          <Group gap={4} wrap="nowrap">
            <IconFolder size={14} style={{ flexShrink: 0 }} />
            <Text fz="sm" c="dimmed" className={classes.truncatedText}>
              {directory.icon ? `${directory.icon} ${directory.name}` : directory.name}
            </Text>
          </Group>
        </Tooltip>,
      );
    }
    if (topic) {
      items.push(
        <Tooltip label={topic.name} key="topic-prefix">
          <Group gap={4} wrap="nowrap">
            <IconTag size={14} style={{ flexShrink: 0 }} />
            <Text fz="sm" c="dimmed" className={classes.truncatedText}>
              {topic.icon ? `${topic.icon} ${topic.name}` : topic.name}
            </Text>
          </Group>
        </Tooltip>,
      );
    }
    return items;
  };

  const getBreadcrumbItems = () => {
    if (!breadcrumbNodes) return [];

    const prefix = getPrefixItems();

    if (breadcrumbNodes.length > 3) {
      const firstNode = breadcrumbNodes[0];
      //const secondLastNode = breadcrumbNodes[breadcrumbNodes.length - 2];
      const lastNode = breadcrumbNodes[breadcrumbNodes.length - 1];

      return [
        ...prefix,
        renderAnchor(firstNode),
        <Popover
          width={250}
          position="bottom"
          withArrow
          shadow="xl"
          key="hidden-nodes"
        >
          <Popover.Target>
            <ActionIcon color="gray" variant="transparent">
              <IconDots size={20} stroke={2} />
            </ActionIcon>
          </Popover.Target>
          <Popover.Dropdown>
            <HiddenNodesTooltipContent />
          </Popover.Dropdown>
        </Popover>,
        //renderAnchor(secondLastNode),
        renderAnchor(lastNode),
      ];
    }

    return [...prefix, ...breadcrumbNodes.map(renderAnchor)];
  };

  const getMobileBreadcrumbItems = () => {
    if (!breadcrumbNodes) return [];

    if (breadcrumbNodes.length > 0) {
      return [
        <Popover
          width={250}
          position="bottom"
          withArrow
          shadow="xl"
          key="mobile-hidden-nodes"
        >
          <Popover.Target>
            <Tooltip label="Breadcrumbs">
              <ActionIcon color="gray" variant="transparent">
                <IconCornerDownRightDouble size={20} stroke={2} />
              </ActionIcon>
            </Tooltip>
          </Popover.Target>
          <Popover.Dropdown>
            <MobileHiddenNodesTooltipContent />
          </Popover.Dropdown>
        </Popover>,
      ];
    }

    return breadcrumbNodes.map(renderAnchor);
  };

  return (
    <div className={classes.breadcrumbDiv}>
      {breadcrumbNodes && (
        <Breadcrumbs className={classes.breadcrumbs}>
          {isMobile ? getMobileBreadcrumbItems() : getBreadcrumbItems()}
        </Breadcrumbs>
      )}
    </div>
  );
}
