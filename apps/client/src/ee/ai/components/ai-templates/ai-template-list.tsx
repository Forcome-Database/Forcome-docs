import { useState } from "react";
import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Stack,
  Table,
  Text,
  Tooltip,
} from "@mantine/core";
import { IconEdit, IconTrash, IconPlus } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { notifications } from "@mantine/notifications";
import {
  useAiTemplatesQuery,
  useDeleteAiTemplateMutation,
} from "@/ee/ai/queries/ai-template-query";
import { IAiTemplate } from "@/ee/ai/types/ai-template.types";
import AiTemplateEditor from "./ai-template-editor";

export default function AiTemplateList() {
  const { t } = useTranslation();
  const { data: templates, isLoading } = useAiTemplatesQuery();
  const deleteMutation = useDeleteAiTemplateMutation();

  const [editorOpened, setEditorOpened] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<IAiTemplate | null>(
    null,
  );

  // Filter to show workspace-level and system templates (admin view)
  const workspaceTemplates = templates?.filter(
    (t) => t.source === "workspace" || t.source === "system",
  );

  const handleEdit = (template: IAiTemplate) => {
    setEditingTemplate(template);
    setEditorOpened(true);
  };

  const handleCreate = () => {
    setEditingTemplate(null);
    setEditorOpened(true);
  };

  const handleDelete = async (template: IAiTemplate) => {
    if (!template.id) return;
    try {
      await deleteMutation.mutateAsync({ templateId: template.id });
      notifications.show({
        message: t("Template deleted"),
        color: "green",
      });
    } catch (err: any) {
      notifications.show({
        message: err?.response?.data?.message || t("Failed to delete"),
        color: "red",
      });
    }
  };

  const scopeBadge = (template: IAiTemplate) => {
    if (template.isDefault) {
      return (
        <Badge size="xs" variant="light" color="blue">
          {t("Default")}
        </Badge>
      );
    }
    if (template.source === "workspace") {
      return (
        <Badge size="xs" variant="light" color="teal">
          {t("Custom")}
        </Badge>
      );
    }
    return null;
  };

  return (
    <Stack gap="xs">
      <Group justify="space-between">
        <div>
          <Text size="md" fw={500}>
            {t("Template management")}
          </Text>
          <Text size="sm" c="dimmed">
            {t(
              "Manage workspace-level AI templates. These are available to all members.",
            )}
          </Text>
        </div>
        <Button
          size="xs"
          leftSection={<IconPlus size={14} />}
          onClick={handleCreate}
        >
          {t("Add template")}
        </Button>
      </Group>

      {isLoading ? (
        <Text size="sm" c="dimmed">
          {t("Loading...")}
        </Text>
      ) : workspaceTemplates && workspaceTemplates.length > 0 ? (
        <Table striped highlightOnHover withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t("Key")}</Table.Th>
              <Table.Th>{t("Name")}</Table.Th>
              <Table.Th>{t("Type")}</Table.Th>
              <Table.Th style={{ width: 80 }}>{t("Actions")}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {workspaceTemplates.map((tmpl) => (
              <Table.Tr key={tmpl.key}>
                <Table.Td>
                  <Text size="sm" ff="monospace">
                    {tmpl.key}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm">{tmpl.name}</Text>
                </Table.Td>
                <Table.Td>{scopeBadge(tmpl)}</Table.Td>
                <Table.Td>
                  <Group gap={4}>
                    {tmpl.id ? (
                      <>
                        <Tooltip label={t("Edit")} openDelay={300}>
                          <ActionIcon
                            variant="subtle"
                            size="sm"
                            onClick={() => handleEdit(tmpl)}
                          >
                            <IconEdit size={14} />
                          </ActionIcon>
                        </Tooltip>
                        {!tmpl.isDefault && (
                          <Tooltip label={t("Delete")} openDelay={300}>
                            <ActionIcon
                              variant="subtle"
                              color="red"
                              size="sm"
                              onClick={() => handleDelete(tmpl)}
                              loading={deleteMutation.isPending}
                            >
                              <IconTrash size={14} />
                            </ActionIcon>
                          </Tooltip>
                        )}
                      </>
                    ) : (
                      <Text size="xs" c="dimmed">
                        {t("System")}
                      </Text>
                    )}
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      ) : (
        <Text size="sm" c="dimmed">
          {t("No templates found")}
        </Text>
      )}

      <AiTemplateEditor
        opened={editorOpened}
        onClose={() => setEditorOpened(false)}
        template={editingTemplate}
        scope="workspace"
      />
    </Stack>
  );
}
