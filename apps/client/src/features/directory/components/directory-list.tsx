import { ActionIcon, Button, Code, Group, Stack, Table, Text, Tooltip } from "@mantine/core";
import {
  IconEdit,
  IconTrash,
  IconPlus,
  IconFolder,
  IconShieldLock,
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
import { ResourcePermissionModal } from "@/features/resource-permission/components/resource-permission-modal";

interface DirectoryListProps {
  spaceId: string;
  readOnly?: boolean;
}

const rowActionStyle: React.CSSProperties = {
  opacity: 0,
  transition: "opacity 150ms",
};

export function DirectoryList({ spaceId, readOnly }: DirectoryListProps) {
  const { t } = useTranslation();
  const { data } = useGetDirectoriesQuery(spaceId);
  const deleteDir = useDeleteDirectoryMutation(spaceId);
  const [opened, { open, close }] = useDisclosure(false);
  const [editingDir, setEditingDir] = useState<IDirectory | null>(null);
  const [permDir, setPermDir] = useState<IDirectory | null>(null);
  const [permOpened, { open: openPerm, close: closePerm }] = useDisclosure(false);

  const handleEdit = (dir: IDirectory) => {
    setEditingDir(dir);
    open();
  };

  const handleCreate = () => {
    setEditingDir(null);
    open();
  };

  const handleManagePermissions = (dir: IDirectory) => {
    setPermDir(dir);
    openPerm();
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
              {!readOnly && <Table.Th w={120} ta="right">{t("Actions")}</Table.Th>}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {directories.map((dir) => (
              <Table.Tr
                key={dir.id}
                style={{ cursor: "default" }}
                onMouseEnter={(e) => {
                  const actions = e.currentTarget.querySelector<HTMLElement>("[data-actions]");
                  if (actions) actions.style.opacity = "1";
                }}
                onMouseLeave={(e) => {
                  const actions = e.currentTarget.querySelector<HTMLElement>("[data-actions]");
                  if (actions) actions.style.opacity = "0";
                }}
              >
                <Table.Td>
                  <Group gap="xs" wrap="nowrap">
                    {dir.icon ? (
                      <span>{dir.icon}</span>
                    ) : (
                      <IconFolder size={16} style={{ flexShrink: 0 }} />
                    )}
                    <Text size="sm" lineClamp={1}>{dir.name}</Text>
                  </Group>
                </Table.Td>
                <Table.Td>
                  <Code style={{ fontSize: "var(--mantine-font-size-xs)", background: "transparent" }}>
                    {dir.slug}
                  </Code>
                </Table.Td>
                {!readOnly && (
                  <Table.Td>
                    <Group gap={4} wrap="nowrap" justify="flex-end" data-actions style={rowActionStyle}>
                      <Tooltip label={t("Manage permissions")} openDelay={300} withArrow>
                        <ActionIcon
                          variant="subtle"
                          size="sm"
                          onClick={() => handleManagePermissions(dir)}
                        >
                          <IconShieldLock size={16} />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label={t("Edit")} openDelay={300} withArrow>
                        <ActionIcon
                          variant="subtle"
                          size="sm"
                          onClick={() => handleEdit(dir)}
                        >
                          <IconEdit size={16} />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label={t("Delete")} openDelay={300} withArrow>
                        <ActionIcon
                          variant="subtle"
                          size="sm"
                          color="red"
                          onClick={() => handleDelete(dir)}
                        >
                          <IconTrash size={16} />
                        </ActionIcon>
                      </Tooltip>
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

      {permDir && (
        <ResourcePermissionModal
          opened={permOpened}
          onClose={closePerm}
          resourceType="directory"
          resourceId={permDir.id}
          resourceName={permDir.name}
        />
      )}
    </Stack>
  );
}
