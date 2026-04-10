import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  ComboboxItem,
  Group,
  Loader,
  Modal,
  Select,
  SelectProps,
  Stack,
  Table,
  Text,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { modals } from "@mantine/modals";
import { IconInfoCircle, IconTrash, IconUserPlus } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { useEffect, useMemo, useState } from "react";
import {
  useAddResourcePermissionMutation,
  useRemoveResourcePermissionMutation,
  useResourcePermissionsQuery,
  useUpdateResourcePermissionMutation,
} from "@/features/resource-permission/queries/resource-permission-query";
import { ResourcePermissionRecord } from "@/features/resource-permission/types/resource-permission.types";
import { useSearchSuggestionsQuery } from "@/features/search/queries/search-query";
import { IUser } from "@/features/user/types/user.types";
import { IGroup } from "@/features/group/types/group.types";
import { CustomAvatar } from "@/components/ui/custom-avatar";
import { IconGroupCircle } from "@/components/icons/icon-people-circle";

interface ResourcePermissionModalProps {
  opened: boolean;
  onClose: () => void;
  resourceType: "directory" | "page";
  resourceId: string;
  resourceName: string;
}

/** A single-item searchable selector for users OR groups depending on principalType. */
function PrincipalSelect({
  principalType,
  value,
  onChange,
}: {
  principalType: "user" | "group";
  value: string;
  onChange: (id: string, label: string) => void;
}) {
  const { t } = useTranslation();
  const [searchValue, setSearchValue] = useState("");
  const [debouncedQuery] = useDebouncedValue(searchValue, 400);

  const { data: suggestion, isLoading } = useSearchSuggestionsQuery({
    query: debouncedQuery,
    includeUsers: principalType === "user",
    includeGroups: principalType === "group",
  });

  const data = useMemo<ComboboxItem[]>(() => {
    if (!suggestion) return [];
    if (principalType === "user") {
      return (suggestion.users ?? []).map((user: IUser) => ({
        value: user.id,
        label: user.name ?? user.email,
      }));
    }
    return (suggestion.groups ?? []).map((group: IGroup) => ({
      value: group.id,
      label: group.name,
    }));
  }, [suggestion, principalType]);

  const renderOption: SelectProps["renderOption"] = ({ option }) => {
    if (principalType === "user") {
      const user = (suggestion?.users ?? []).find(
        (u: IUser) => u.id === option.value,
      );
      return (
        <Group gap="sm" wrap="nowrap">
          <CustomAvatar
            avatarUrl={user?.avatarUrl}
            size={20}
            name={option.label}
          />
          <div>
            <Text size="sm" lineClamp={1}>
              {option.label}
            </Text>
            {user?.email && (
              <Text size="xs" c="dimmed" lineClamp={1}>
                {user.email}
              </Text>
            )}
          </div>
        </Group>
      );
    }
    return (
      <Group gap="sm" wrap="nowrap">
        <IconGroupCircle />
        <Text size="sm" lineClamp={1}>
          {option.label}
        </Text>
      </Group>
    );
  };

  return (
    <Select
      label={principalType === "user" ? t("User") : t("Group")}
      size="xs"
      placeholder={
        principalType === "user"
          ? t("Search by name or email…")
          : t("Search groups…")
      }
      searchable
      searchValue={searchValue}
      onSearchChange={setSearchValue}
      data={data}
      value={value || null}
      onChange={(val) => {
        if (!val) return;
        const found = data.find((d) => d.value === val);
        onChange(val, found?.label ?? val);
      }}
      filter={({ options }) => options}
      rightSection={isLoading ? <Loader size={12} /> : undefined}
      nothingFoundMessage={
        debouncedQuery ? t("No results") : t("Type to search…")
      }
      renderOption={renderOption}
      clearable
      allowDeselect
    />
  );
}

/** Display label for a permission row: name if available, else truncated UUID. */
function PrincipalLabel({ record }: { record: ResourcePermissionRecord }) {
  if (record.principalName) {
    return (
      <Group gap={6} wrap="nowrap">
        {record.principalType === "user" ? (
          <CustomAvatar
            avatarUrl={record.principalAvatarUrl ?? undefined}
            size={18}
            name={record.principalName}
          />
        ) : (
          <IconGroupCircle />
        )}
        <div>
          <Text size="sm" lineClamp={1}>
            {record.principalName}
          </Text>
          {record.principalEmail && (
            <Text size="xs" c="dimmed" lineClamp={1}>
              {record.principalEmail}
            </Text>
          )}
        </div>
      </Group>
    );
  }
  // Fallback: show truncated UUID
  return (
    <Text size="sm" ff="monospace" truncate style={{ maxWidth: 200 }}>
      {record.principalId}
    </Text>
  );
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
    principalLabel: "",
    role: "reader" as string,
  });
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Reset principalId when type changes so stale selection is cleared.
  useEffect(() => {
    setAddForm((f) => ({ ...f, principalId: "", principalLabel: "" }));
  }, [addForm.principalType]);

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
          setAddForm({
            principalType: "user",
            principalId: "",
            principalLabel: "",
            role: "reader",
          });
          setShowAddForm(false);
        },
      },
    );
  };

  const handleClearOverrides = () => {
    if (!permissions) return;
    modals.openConfirmModal({
      title: t("Clear all overrides"),
      children: (
        <Text size="sm">
          {t(
            "Are you sure? This will revert to inheriting space permissions.",
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
          py="xs"
        >
          <Text size="sm">
            {hasOverrides
              ? t("Custom overrides are active. These replace inherited space permissions.")
              : t("Inheriting from space. Add overrides below to customize.")}
          </Text>
        </Alert>

        {isLoading ? (
          <Group justify="center" py="md">
            <Loader size="sm" />
          </Group>
        ) : hasOverrides ? (
          <>
            <Table highlightOnHover verticalSpacing={8}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t("Member")}</Table.Th>
                  <Table.Th>{t("Role")}</Table.Th>
                  <Table.Th w={40}></Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {permissions.map((record) => (
                  <Table.Tr key={record.id}>
                    <Table.Td>
                      <Group gap={8} wrap="nowrap">
                        <PrincipalLabel record={record} />
                        <Badge size="xs" variant="light" color="gray" style={{ flexShrink: 0 }}>
                          {record.principalType === "user" ? t("User") : t("Group")}
                        </Badge>
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <Select
                        size="xs"
                        data={roleOptions}
                        value={record.role}
                        onChange={(val) => val && handleRoleChange(record, val)}
                        w={140}
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

            <Group justify="flex-end">
              <Button
                variant="subtle"
                size="xs"
                color="red"
                onClick={handleClearOverrides}
              >
                {t("Clear all overrides")}
              </Button>
            </Group>
          </>
        ) : (
          <Text c="dimmed" ta="center" py="md" size="sm">
            {t("No overrides. Access is inherited from the space.")}
          </Text>
        )}

        {showAddForm ? (
          <Stack
            gap="sm"
            p="sm"
            style={{
              border: "1px solid var(--mantine-color-default-border)",
              borderRadius: 8,
            }}
          >
            <Group align="flex-end" wrap="nowrap" gap="sm">
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
                style={{ flex: "0 0 90px" }}
              />
              <div style={{ flex: 1 }}>
                <PrincipalSelect
                  key={addForm.principalType}
                  principalType={addForm.principalType}
                  value={addForm.principalId}
                  onChange={(id, label) =>
                    setAddForm((f) => ({
                      ...f,
                      principalId: id,
                      principalLabel: label,
                    }))
                  }
                />
              </div>
              <Select
                label={t("Role")}
                size="xs"
                data={roleOptions}
                value={addForm.role}
                onChange={(val) =>
                  val && setAddForm((f) => ({ ...f, role: val }))
                }
                allowDeselect={false}
                style={{ flex: "0 0 120px" }}
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
          <Button
            variant="light"
            size="xs"
            leftSection={<IconUserPlus size={15} />}
            onClick={() => setShowAddForm(true)}
          >
            {t("Add member / group")}
          </Button>
        )}
      </Stack>
    </Modal>
  );
}
