import { useState, useEffect } from "react";
import {
  Button,
  Group,
  Modal,
  Select,
  Stack,
  TextInput,
  Textarea,
} from "@mantine/core";
import {
  IconFileCode,
  IconBook,
  IconClipboardList,
  IconChartBar,
  IconNotes,
  IconChecklist,
  IconFileText,
  IconBulb,
  IconPresentation,
  IconFileAnalytics,
  IconWriting,
  IconBriefcase,
  IconCode,
  IconSchool,
  IconMessage,
  IconList,
} from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { notifications } from "@mantine/notifications";
import {
  useCreateAiTemplateMutation,
  useUpdateAiTemplateMutation,
} from "@/ee/ai/queries/ai-template-query";
import { IAiTemplate } from "@/ee/ai/types/ai-template.types";

// Icon registry: name → component mapping
const ICON_MAP: Record<string, React.FC<any>> = {
  IconFileCode,
  IconBook,
  IconClipboardList,
  IconChartBar,
  IconNotes,
  IconChecklist,
  IconFileText,
  IconBulb,
  IconPresentation,
  IconFileAnalytics,
  IconWriting,
  IconBriefcase,
  IconCode,
  IconSchool,
  IconMessage,
  IconList,
};

const ICON_OPTIONS = [
  { value: "IconFileCode", label: "IconFileCode — 代码文件" },
  { value: "IconBook", label: "IconBook — 书籍/手册" },
  { value: "IconClipboardList", label: "IconClipboardList — 需求清单" },
  { value: "IconChartBar", label: "IconChartBar — 图表/报告" },
  { value: "IconNotes", label: "IconNotes — 笔记" },
  { value: "IconChecklist", label: "IconChecklist — 检查清单" },
  { value: "IconFileText", label: "IconFileText — 文本文件" },
  { value: "IconBulb", label: "IconBulb — 创意/灵感" },
  { value: "IconPresentation", label: "IconPresentation — 演示" },
  { value: "IconFileAnalytics", label: "IconFileAnalytics — 分析" },
  { value: "IconWriting", label: "IconWriting — 写作" },
  { value: "IconBriefcase", label: "IconBriefcase — 商务" },
  { value: "IconCode", label: "IconCode — 代码" },
  { value: "IconSchool", label: "IconSchool — 教育" },
  { value: "IconMessage", label: "IconMessage — 沟通" },
  { value: "IconList", label: "IconList — 列表" },
];

interface AiTemplateEditorProps {
  opened: boolean;
  onClose: () => void;
  template?: IAiTemplate | null;
  scope: "workspace" | "user";
}

function IconPreview({ name }: { name: string }) {
  const Comp = ICON_MAP[name];
  if (!Comp) return null;
  return <Comp size={18} />;
}

export default function AiTemplateEditor({
  opened,
  onClose,
  template,
  scope,
}: AiTemplateEditorProps) {
  const { t } = useTranslation();
  const createMutation = useCreateAiTemplateMutation();
  const updateMutation = useUpdateAiTemplateMutation();

  // Edit mode: updating existing template (has id)
  // Create mode: creating new template (no id)
  const isEditing = !!template?.id;

  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState<string | null>("");
  const [prompt, setPrompt] = useState("");

  useEffect(() => {
    if (opened) {
      if (template) {
        setKey(template.key);
        setName(template.name);
        setDescription(template.description || "");
        setIcon(template.icon || null);
        setPrompt(template.prompt);
      } else {
        setKey("");
        setName("");
        setDescription("");
        setIcon(null);
        setPrompt("");
      }
    }
  }, [opened, template]);

  const handleSubmit = async () => {
    if (!key.trim() || !name.trim() || !prompt.trim()) {
      notifications.show({
        message: t("Key, name and prompt are required"),
        color: "red",
      });
      return;
    }

    try {
      if (isEditing) {
        await updateMutation.mutateAsync({
          templateId: template!.id!,
          name: name.trim(),
          description: description.trim() || undefined,
          icon: icon || undefined,
          prompt: prompt.trim(),
        });
        notifications.show({
          message: t("Template updated"),
          color: "green",
        });
      } else {
        await createMutation.mutateAsync({
          key: key.trim(),
          name: name.trim(),
          description: description.trim() || undefined,
          icon: icon || undefined,
          prompt: prompt.trim(),
          scope,
        });
        notifications.show({
          message: t("Template created"),
          color: "green",
        });
      }
      onClose();
    } catch (err: any) {
      notifications.show({
        message: err?.response?.data?.message || t("Operation failed"),
        color: "red",
      });
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={isEditing ? t("Edit template") : t("Create template")}
      size="lg"
    >
      <Stack gap="sm">
        <TextInput
          label={t("Key")}
          description={t("Unique identifier (slug), e.g. technical-doc")}
          placeholder="my-template"
          value={key}
          onChange={(e) => setKey(e.currentTarget.value)}
          disabled={isEditing}
          required
        />

        <TextInput
          label={t("Name")}
          description={t("Display name shown in template menu")}
          placeholder={t("My Template")}
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          required
        />

        <TextInput
          label={t("Description")}
          placeholder={t("Brief description of this template")}
          value={description}
          onChange={(e) => setDescription(e.currentTarget.value)}
        />

        <Select
          label={t("Icon")}
          description={t("Choose an icon for this template")}
          placeholder={t("Select icon...")}
          data={ICON_OPTIONS}
          value={icon}
          onChange={setIcon}
          clearable
          searchable
          leftSection={icon ? <IconPreview name={icon} /> : undefined}
          renderOption={({ option }) => (
            <Group gap="xs">
              <IconPreview name={option.value} />
              <span>{option.label}</span>
            </Group>
          )}
        />

        <Textarea
          label={t("Prompt")}
          description={t("System prompt content sent to AI")}
          placeholder={t("You are a professional writer...")}
          minRows={8}
          maxRows={20}
          autosize
          value={prompt}
          onChange={(e) => setPrompt(e.currentTarget.value)}
          required
        />

        <Group justify="flex-end" mt="sm">
          <Button variant="subtle" onClick={onClose} disabled={isPending}>
            {t("Cancel")}
          </Button>
          <Button onClick={handleSubmit} loading={isPending}>
            {isEditing ? t("Save") : t("Create")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
