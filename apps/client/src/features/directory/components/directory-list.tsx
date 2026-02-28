import { ActionIcon, Button, Group, Stack, Table, Text } from "@mantine/core";
import {
  IconEdit,
  IconTrash,
  IconPlus,
  IconFolder,
} from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import {
  useGetDirectoriesQuery,
  useDeleteDirectoryMutation,
} from "../queries/directory-query";
import { IDirectory } from "../types/directory.types";
import { useDisclosure } from "@mantine/hooks";
import { modals } from "@mantine/modals";
import { DirectoryFormModal } from "./directory-form-modal";
import { useState } from "react";

interface DirectoryListProps {
  spaceId: string;
  readOnly?: boolean;
}

export function DirectoryList({ spaceId, readOnly }: DirectoryListProps) {
  const { t } = useTranslation();
  const { data } = useGetDirectoriesQuery(spaceId);
  const deleteDir = useDeleteDirectoryMutation(spaceId);
  const [opened, { open, close }] = useDisclosure(false);
  const [editingDir, setEditingDir] = useState<IDirectory | null>(null);

  const handleEdit = (dir: IDirectory) => {
    setEditingDir(dir);
    open();
  };

  const handleCreate = () => {
    setEditingDir(null);
    open();
  };

  const handleDelete = (dir: IDirectory) => {
    modals.openConfirmModal({
      title: t("Delete directory"),
      children: (
        <Text size="sm">
          {t(
            "Are you sure you want to delete this directory? Pages in this directory will become uncategorized.",
          )}
        </Text>
      ),
      centered: true,
      labels: { confirm: t("Delete"), cancel: t("Cancel") },
      confirmProps: { color: "red" },
      onConfirm: () => deleteDir.mutate(dir.id),
    });
  };

  const directories = data?.items || [];

  return (
    <Stack>
      {!readOnly && (
        <Group justify="flex-end">
          <Button
            leftSection={<IconPlus size={16} />}
            size="xs"
            onClick={handleCreate}
          >
            {t("Create directory")}
          </Button>
        </Group>
      )}

      {directories.length === 0 ? (
        <Text c="dimmed" ta="center" py="xl">
          {t("No directories yet")}
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
            {directories.map((dir) => (
              <Table.Tr key={dir.id}>
                <Table.Td>
                  <Group gap="xs">
                    {dir.icon ? (
                      <span>{dir.icon}</span>
                    ) : (
                      <IconFolder size={16} />
                    )}
                    <Text size="sm">{dir.name}</Text>
                  </Group>
                </Table.Td>
                <Table.Td>
                  <Text size="sm" c="dimmed">
                    {dir.slug}
                  </Text>
                </Table.Td>
                {!readOnly && (
                  <Table.Td>
                    <Group gap="xs">
                      <ActionIcon
                        variant="subtle"
                        size="sm"
                        onClick={() => handleEdit(dir)}
                      >
                        <IconEdit size={16} />
                      </ActionIcon>
                      <ActionIcon
                        variant="subtle"
                        size="sm"
                        color="red"
                        onClick={() => handleDelete(dir)}
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

      <DirectoryFormModal
        opened={opened}
        onClose={close}
        spaceId={spaceId}
        directory={editingDir}
      />
    </Stack>
  );
}
