import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Modal,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { modals } from "@mantine/modals";
import { IconInfoCircle, IconTrash, IconUserPlus } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { useMemo, useState } from "react";
import {
  useAddResourcePermissionMutation,
  useRemoveResourcePermissionMutation,
  useResourcePermissionsQuery,
  useUpdateResourcePermissionMutation,
} from "@/features/resource-permission/queries/resource-permission-query";
import { ResourcePermissionRecord } from "@/features/resource-permission/types/resource-permission.types";

interface ResourcePermissionModalProps {
  opened: boolean;
  onClose: () => void;
  resourceType: "directory" | "page";
  resourceId: string;
  resourceName: string;
}

export function ResourcePermissionModal({
  opened,
  onClose,
  resourceType,
  resourceId,
  resourceName,
}: ResourcePermissionModalProps) {
  const { t } = useTranslation();

  const roleOptions = useMemo(
    () => [
      { value: "admin", label: t("Admin") },
      { value: "writer", label: t("Writer") },
      { value: "reader", label: t("Reader") },
      { value: "none", label: t("None (deny)") },
    ],
    [t],
  );

  const { data: permissions, isLoading } = useResourcePermissionsQuery(
    resourceType,
    resourceId,
  );
  const updateMutation = useUpdateResourcePermissionMutation(
    resourceType,
    resourceId,
  );
  const removeMutation = useRemoveResourcePermissionMutation(
    resourceType,
    resourceId,
  );
  const addMutation = useAddResourcePermissionMutation(resourceType, resourceId);

  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState({
    principalType: "user" as "user" | "group",
    principalId: "",
    role: "reader" as string,
  });
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const hasOverrides = permissions && permissions.length > 0;

  const handleRoleChange = (record: ResourcePermissionRecord, role: string) => {
    updateMutation.mutate({ id: record.id, role });
  };

  const handleRemove = (id: string) => {
    setDeletingId(id);
    removeMutation.mutate(id, { onSettled: () => setDeletingId(null) });
  };

  const handleAdd = () => {
    if (!addForm.principalId.trim()) return;
    addMutation.mutate(
      {
        principalType: addForm.principalType,
        principalId: addForm.principalId.trim(),
        role: addForm.role,
      },
      {
        onSuccess: () => {
          setAddForm({ principalType: "user", principalId: "", role: "reader" });
          setShowAddForm(false);
        },
      },
    );
  };

  const handleClearOverrides = () => {
    if (!permissions) return;
    modals.openConfirmModal({
      title: t("Clear overrides (revert to inherited)"),
      children: (
        <Text size="sm">
          {t(
            "Are you sure you want to clear all permission overrides? This {{type}} will revert to inheriting space permissions.",
            { type: resourceType },
          )}
        </Text>
      ),
      centered: true,
      labels: { confirm: t("Clear"), cancel: t("Cancel") },
      confirmProps: { color: "red" },
      onConfirm: async () => {
        try {
          for (const p of permissions) {
            await removeMutation.mutateAsync(p.id);
          }
          notifications.show({
            message: t("All overrides cleared"),
            color: "green",
          });
        } catch {
          notifications.show({
            message: t("Failed to clear some overrides"),
            color: "red",
          });
        }
      },
    });
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Text fw={600}>
          {t("Permissions: {{name}}", { name: resourceName })}
        </Text>
      }
      size="lg"
    >
      <Stack>
        <Alert
          icon={<IconInfoCircle size={16} />}
          color={hasOverrides ? "blue" : "gray"}
          variant="light"
        >
          {hasOverrides
            ? t(
                "This {{type}} has custom permission overrides. These override inherited space permissions.",
                { type: resourceType },
              )
            : t(
                "This {{type}} inherits permissions from its space. Add overrides below to customize access.",
                { type: resourceType },
              )}
        </Alert>

        {isLoading ? (
          <Group justify="center" py="md">
            <Loader size="sm" />
          </Group>
        ) : hasOverrides ? (
          <Table highlightOnHover verticalSpacing={8}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t("Principal")}</Table.Th>
                <Table.Th>{t("Type")}</Table.Th>
                <Table.Th>{t("Role")}</Table.Th>
                <Table.Th w={50}></Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {permissions.map((record) => (
                <Table.Tr key={record.id}>
                  <Table.Td>
                    <Text size="sm" ff="monospace" truncate style={{ maxWidth: 200 }}>
                      {record.principalId}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge size="sm" variant="outline" color="gray">
                      {record.principalType}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Select
                      size="xs"
                      data={roleOptions}
                      value={record.role}
                      onChange={(val) => val && handleRoleChange(record, val)}
                      w={130}
                      allowDeselect={false}
                    />
                  </Table.Td>
                  <Table.Td>
                    <ActionIcon
                      variant="subtle"
                      size="sm"
                      color="red"
                      onClick={() => handleRemove(record.id)}
                      loading={deletingId === record.id}
                    >
                      <IconTrash size={15} />
                    </ActionIcon>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        ) : (
          <Text c="dimmed" ta="center" py="sm" size="sm">
            {t("No permission overrides. Access is inherited from the space.")}
          </Text>
        )}

        {showAddForm ? (
          <Stack gap="xs" p="sm" style={{ border: "1px solid var(--mantine-color-default-border)", borderRadius: 8 }}>
            <Text size="sm" fw={500}>
              {t("Add permission override")}
            </Text>
            <Group align="flex-end" grow>
              <Select
                label={t("Type")}
                size="xs"
                data={[
                  { value: "user", label: t("User") },
                  { value: "group", label: t("Group") },
                ]}
                value={addForm.principalType}
                onChange={(val) =>
                  val &&
                  setAddForm((f) => ({
                    ...f,
                    principalType: val as "user" | "group",
                  }))
                }
                allowDeselect={false}
                style={{ flex: "0 0 100px" }}
              />
              <TextInput
                label={t("User / Group ID (UUID)")}
                size="xs"
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                value={addForm.principalId}
                onChange={(e) =>
                  setAddForm((f) => ({ ...f, principalId: e.target.value }))
                }
              />
              <Select
                label={t("Role")}
                size="xs"
                data={roleOptions}
                value={addForm.role}
                onChange={(val) =>
                  val && setAddForm((f) => ({ ...f, role: val }))
                }
                allowDeselect={false}
                style={{ flex: "0 0 130px" }}
              />
            </Group>
            <Group justify="flex-end" gap="xs">
              <Button
                variant="default"
                size="xs"
                onClick={() => setShowAddForm(false)}
              >
                {t("Cancel")}
              </Button>
              <Button
                size="xs"
                onClick={handleAdd}
                loading={addMutation.isPending}
                disabled={!addForm.principalId.trim()}
              >
                {t("Add")}
              </Button>
            </Group>
          </Stack>
        ) : (
          <Group justify="space-between">
            <Button
              variant="light"
              size="xs"
              leftSection={<IconUserPlus size={15} />}
              onClick={() => setShowAddForm(true)}
            >
              {t("Add member / group")}
            </Button>

            {hasOverrides && (
              <Button
                variant="subtle"
                size="xs"
                color="red"
                onClick={handleClearOverrides}
              >
                {t("Clear overrides (revert to inherited)")}
              </Button>
            )}
          </Group>
        )}

        {!hasOverrides && !showAddForm && (
          <Text size="xs" c="dimmed" ta="center">
            {t(
              "When all overrides are removed, this {{type}} reverts to inheriting space permissions.",
              { type: resourceType },
            )}
          </Text>
        )}
      </Stack>
    </Modal>
  );
}
