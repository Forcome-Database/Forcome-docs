import { useState } from "react";
import {
  Text,
  UnstyledButton,
  Collapse,
  Group,
  Stack,
  ActionIcon,
  Tooltip,
} from "@mantine/core";
import {
  IconChevronRight,
  IconFolder,
  IconPlus,
  IconTag,
} from "@tabler/icons-react";
import { useGetDirectoriesQuery } from "../queries/directory-query";
import { useGetTopicsQuery } from "@/features/topic/queries/topic-query";
import { IDirectory } from "../types/directory.types";
import { ITopic } from "@/features/topic/types/topic.types";
import { useNavigate, useParams } from "react-router-dom";
import { useCreatePageMutation } from "@/features/page/queries/page-query";
import { buildPageUrl } from "@/features/page/page.utils";
import { useTranslation } from "react-i18next";

interface SidebarDirectoriesProps {
  spaceId: string;
}

export function SidebarDirectories({ spaceId }: SidebarDirectoriesProps) {
  const { data: dirData } = useGetDirectoriesQuery(spaceId);
  const directories = dirData?.items || [];

  if (directories.length === 0) return null;

  return (
    <Stack gap={0}>
      {directories.map((dir) => (
        <DirectoryNode key={dir.id} directory={dir} spaceId={spaceId} />
      ))}
    </Stack>
  );
}

function DirectoryNode({
  directory,
  spaceId,
}: {
  directory: IDirectory;
  spaceId: string;
}) {
  const { t } = useTranslation();
  const [opened, setOpened] = useState(false);
  const navigate = useNavigate();
  const { spaceSlug } = useParams();
  const createPageMutation = useCreatePageMutation();

  const handleCreatePage = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const page = await createPageMutation.mutateAsync({
        spaceId,
        directoryId: directory.id,
      } as any);
      const pageUrl = buildPageUrl(spaceSlug, page.slugId, page.title);
      navigate(pageUrl);
    } catch {
      // error handled by mutation
    }
  };

  return (
    <>
      <UnstyledButton
        onClick={() => setOpened((o) => !o)}
        py={4}
        px={8}
        w="100%"
        style={{ borderRadius: 4 }}
        className="sidebar-dir-node"
      >
        <Group gap={6} wrap="nowrap" justify="space-between">
          <Group gap={6} wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
            <IconChevronRight
              size={14}
              style={{
                transform: opened ? "rotate(90deg)" : "none",
                transition: "transform 150ms ease",
                flexShrink: 0,
              }}
            />
            {directory.icon ? (
              <Text size="sm" style={{ flexShrink: 0 }}>
                {directory.icon}
              </Text>
            ) : (
              <IconFolder size={16} style={{ flexShrink: 0 }} />
            )}
            <Text size="sm" fw={500} truncate="end">
              {directory.name}
            </Text>
          </Group>
          <Tooltip label={t("Create page")} withArrow position="right">
            <ActionIcon
              variant="subtle"
              size={18}
              c="gray"
              onClick={handleCreatePage}
              style={{ flexShrink: 0 }}
            >
              <IconPlus size={14} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </UnstyledButton>
      <Collapse in={opened}>
        <div style={{ paddingLeft: 16 }}>
          <DirectoryContent directoryId={directory.id} spaceId={spaceId} />
        </div>
      </Collapse>
    </>
  );
}

function DirectoryContent({
  directoryId,
  spaceId,
}: {
  directoryId: string;
  spaceId: string;
}) {
  const { t } = useTranslation();
  const { data: topicData } = useGetTopicsQuery(directoryId);
  const topics = topicData?.items || [];

  if (topics.length === 0) {
    return (
      <Text size="xs" c="dimmed" py={4} px={8}>
        {t("No topics yet")}
      </Text>
    );
  }

  return (
    <Stack gap={0}>
      {topics.map((topic) => (
        <TopicNode key={topic.id} topic={topic} spaceId={spaceId} />
      ))}
    </Stack>
  );
}

function TopicNode({
  topic,
  spaceId,
}: {
  topic: ITopic;
  spaceId: string;
}) {
  const { t } = useTranslation();
  const [opened, setOpened] = useState(false);
  const navigate = useNavigate();
  const { spaceSlug } = useParams();
  const createPageMutation = useCreatePageMutation();

  const handleCreatePage = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const page = await createPageMutation.mutateAsync({
        spaceId,
        directoryId: topic.directoryId,
        topicId: topic.id,
      } as any);
      const pageUrl = buildPageUrl(spaceSlug, page.slugId, page.title);
      navigate(pageUrl);
    } catch {
      // error handled by mutation
    }
  };

  return (
    <>
      <UnstyledButton
        onClick={() => setOpened((o) => !o)}
        py={3}
        px={8}
        w="100%"
        style={{ borderRadius: 4 }}
        className="sidebar-topic-node"
      >
        <Group gap={6} wrap="nowrap" justify="space-between">
          <Group gap={6} wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
            <IconChevronRight
              size={12}
              style={{
                transform: opened ? "rotate(90deg)" : "none",
                transition: "transform 150ms ease",
                flexShrink: 0,
              }}
            />
            {topic.icon ? (
              <Text size="xs" style={{ flexShrink: 0 }}>
                {topic.icon}
              </Text>
            ) : (
              <IconTag size={14} style={{ flexShrink: 0 }} />
            )}
            <Text size="sm" truncate="end">
              {topic.name}
            </Text>
          </Group>
          <Tooltip label={t("Create page")} withArrow position="right">
            <ActionIcon
              variant="subtle"
              size={16}
              c="gray"
              onClick={handleCreatePage}
              style={{ flexShrink: 0 }}
            >
              <IconPlus size={12} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </UnstyledButton>
      <Collapse in={opened}>
        <div style={{ paddingLeft: 16 }}>
          <Text size="xs" c="dimmed" py={4} px={8}>
            {t("No pages yet")}
          </Text>
        </div>
      </Collapse>
    </>
  );
}
