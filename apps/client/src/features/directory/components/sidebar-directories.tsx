import { useState } from "react";
import {
  Text,
  UnstyledButton,
  Collapse,
  Group,
  Stack,
} from "@mantine/core";
import {
  IconChevronRight,
  IconFolder,
  IconTag,
} from "@tabler/icons-react";
import { useGetDirectoriesQuery } from "../queries/directory-query";
import { useGetTopicsQuery } from "@/features/topic/queries/topic-query";
import { IDirectory } from "../types/directory.types";
import { ITopic } from "@/features/topic/types/topic.types";

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
        <DirectoryNode key={dir.id} directory={dir} />
      ))}
    </Stack>
  );
}

function DirectoryNode({ directory }: { directory: IDirectory }) {
  const [opened, setOpened] = useState(false);

  return (
    <>
      <UnstyledButton
        onClick={() => setOpened((o) => !o)}
        py={4}
        px={8}
        w="100%"
        style={{ borderRadius: 4 }}
        styles={{
          root: {
            "&:hover": {
              backgroundColor: "var(--mantine-color-gray-1)",
            },
          },
        }}
      >
        <Group gap={6} wrap="nowrap">
          <IconChevronRight
            size={14}
            style={{
              transform: opened ? "rotate(90deg)" : "none",
              transition: "transform 150ms ease",
            }}
          />
          {directory.icon ? (
            <Text size="sm">{directory.icon}</Text>
          ) : (
            <IconFolder size={16} />
          )}
          <Text size="sm" fw={500} truncate="end">
            {directory.name}
          </Text>
        </Group>
      </UnstyledButton>
      <Collapse in={opened}>
        <div style={{ paddingLeft: 16 }}>
          <DirectoryContent directoryId={directory.id} />
        </div>
      </Collapse>
    </>
  );
}

function DirectoryContent({
  directoryId,
}: {
  directoryId: string;
}) {
  const { data: topicData } = useGetTopicsQuery(directoryId);
  const topics = topicData?.items || [];

  if (topics.length === 0) {
    return (
      <Text size="xs" c="dimmed" py={4} px={8}>
        No topics yet
      </Text>
    );
  }

  return (
    <Stack gap={0}>
      {topics.map((topic) => (
        <TopicNode key={topic.id} topic={topic} />
      ))}
    </Stack>
  );
}

function TopicNode({ topic }: { topic: ITopic }) {
  const [opened, setOpened] = useState(false);

  return (
    <>
      <UnstyledButton
        onClick={() => setOpened((o) => !o)}
        py={3}
        px={8}
        w="100%"
        style={{ borderRadius: 4 }}
        styles={{
          root: {
            "&:hover": {
              backgroundColor: "var(--mantine-color-gray-1)",
            },
          },
        }}
      >
        <Group gap={6} wrap="nowrap">
          <IconChevronRight
            size={12}
            style={{
              transform: opened ? "rotate(90deg)" : "none",
              transition: "transform 150ms ease",
            }}
          />
          {topic.icon ? (
            <Text size="xs">{topic.icon}</Text>
          ) : (
            <IconTag size={14} />
          )}
          <Text size="sm" truncate="end">
            {topic.name}
          </Text>
        </Group>
      </UnstyledButton>
      <Collapse in={opened}>
        <div style={{ paddingLeft: 16 }}>
          <Text size="xs" c="dimmed" py={4} px={8}>
            No pages yet
          </Text>
        </div>
      </Collapse>
    </>
  );
}
