import { ActionIcon, Button, Group, Stack, Table, Text } from "@mantine/core";
import {
  IconEdit,
  IconTrash,
  IconPlus,
  IconTag,
} from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import {
  useGetTopicsQuery,
  useDeleteTopicMutation,
} from "../queries/topic-query";
import { ITopic } from "../types/topic.types";
import { useDisclosure } from "@mantine/hooks";
import { modals } from "@mantine/modals";
import { TopicFormModal } from "./topic-form-modal";
import { useState } from "react";
import { DirectorySelect } from "@/features/directory/components/directory-select";

interface TopicListProps {
  spaceId: string;
  readOnly?: boolean;
}

export function TopicList({ spaceId, readOnly }: TopicListProps) {
  const { t } = useTranslation();
  const [selectedDirectoryId, setSelectedDirectoryId] = useState<string | null>(
    null,
  );
  const { data } = useGetTopicsQuery(selectedDirectoryId || "");
  const deleteTopic = useDeleteTopicMutation(selectedDirectoryId || undefined);
  const [opened, { open, close }] = useDisclosure(false);
  const [editingTopic, setEditingTopic] = useState<ITopic | null>(null);

  const handleEdit = (topic: ITopic) => {
    setEditingTopic(topic);
    open();
  };

  const handleCreate = () => {
    setEditingTopic(null);
    open();
  };

  const handleDelete = (topic: ITopic) => {
    modals.openConfirmModal({
      title: t("Delete topic"),
      children: (
        <Text size="sm">
          {t(
            "Are you sure you want to delete this topic? Pages in this topic will remain in the directory.",
          )}
        </Text>
      ),
      centered: true,
      labels: { confirm: t("Delete"), cancel: t("Cancel") },
      confirmProps: { color: "red" },
      onConfirm: () => deleteTopic.mutate(topic.id),
    });
  };

  const topics = data?.items || [];

  return (
    <Stack>
      <DirectorySelect
        spaceId={spaceId}
        value={selectedDirectoryId}
        onChange={setSelectedDirectoryId}
      />

      {selectedDirectoryId && !readOnly && (
        <Group justify="flex-end">
          <Button
            leftSection={<IconPlus size={16} />}
            size="xs"
            onClick={handleCreate}
          >
            {t("Create topic")}
          </Button>
        </Group>
      )}

      {!selectedDirectoryId ? (
        <Text c="dimmed" ta="center" py="xl">
          {t("Select a directory to manage topics")}
        </Text>
      ) : topics.length === 0 ? (
        <Text c="dimmed" ta="center" py="xl">
          {t("No topics yet")}
        </Text>
      ) : (
        <Table highlightOnHover verticalSpacing={8}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t("Name")}</Table.Th>
              <Table.Th>{t("Slug")}</Table.Th>
              {!readOnly && <Table.Th w={100}>{t("Actions")}</Table.Th>}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {topics.map((topic) => (
              <Table.Tr key={topic.id}>
                <Table.Td>
                  <Group gap="xs">
                    {topic.icon ? (
                      <span>{topic.icon}</span>
                    ) : (
                      <IconTag size={16} />
                    )}
                    <Text size="sm">{topic.name}</Text>
                  </Group>
                </Table.Td>
                <Table.Td>
                  <Text size="sm" c="dimmed">
                    {topic.slug}
                  </Text>
                </Table.Td>
                {!readOnly && (
                  <Table.Td>
                    <Group gap="xs">
                      <ActionIcon
                        variant="subtle"
                        size="sm"
                        onClick={() => handleEdit(topic)}
                      >
                        <IconEdit size={16} />
                      </ActionIcon>
                      <ActionIcon
                        variant="subtle"
                        size="sm"
                        color="red"
                        onClick={() => handleDelete(topic)}
                      >
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Group>
                  </Table.Td>
                )}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      {selectedDirectoryId && (
        <TopicFormModal
          opened={opened}
          onClose={close}
          directoryId={selectedDirectoryId}
          topic={editingTopic}
        />
      )}
    </Stack>
  );
}
