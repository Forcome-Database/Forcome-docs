import { useState, useEffect } from "react";
import { Button, Group, Stack, Text, Textarea } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { notifications } from "@mantine/notifications";
import {
  useSystemPromptQuery,
  useUpdateSystemPromptMutation,
} from "@/ee/ai/queries/ai-template-query";

export default function AiSystemPromptEditor() {
  const { t } = useTranslation();
  const { data: systemPrompt, isLoading } = useSystemPromptQuery();
  const updateMutation = useUpdateSystemPromptMutation();
  const [value, setValue] = useState("");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (systemPrompt !== undefined) {
      setValue(systemPrompt);
    }
  }, [systemPrompt]);

  const handleSave = async () => {
    try {
      await updateMutation.mutateAsync({ systemPrompt: value });
      setDirty(false);
      notifications.show({
        message: t("System prompt saved"),
        color: "green",
      });
    } catch (err: any) {
      notifications.show({
        message: err?.response?.data?.message || t("Failed to save"),
        color: "red",
      });
    }
  };

  const handleClear = async () => {
    try {
      await updateMutation.mutateAsync({ systemPrompt: "" });
      setValue("");
      setDirty(false);
      notifications.show({
        message: t("System prompt cleared"),
        color: "green",
      });
    } catch (err: any) {
      notifications.show({
        message: err?.response?.data?.message || t("Failed to clear"),
        color: "red",
      });
    }
  };

  return (
    <Stack gap="xs">
      <div>
        <Text size="md" fw={500}>
          {t("Global system prompt")}
        </Text>
        <Text size="sm" c="dimmed">
          {t(
            "This prompt is prepended to all AI Creator requests. Use it to set consistent tone, language, or formatting rules.",
          )}
        </Text>
      </div>

      <Textarea
        placeholder={t(
          "e.g. Always respond in Chinese. Use professional tone. Format with Markdown headings.",
        )}
        minRows={4}
        maxRows={10}
        autosize
        value={value}
        onChange={(e) => {
          setValue(e.currentTarget.value);
          setDirty(true);
        }}
        disabled={isLoading}
      />

      <Group gap="xs">
        <Button
          size="xs"
          onClick={handleSave}
          disabled={!dirty}
          loading={updateMutation.isPending}
        >
          {t("Save")}
        </Button>
        <Button
          size="xs"
          variant="subtle"
          color="gray"
          onClick={handleClear}
          disabled={!value}
          loading={updateMutation.isPending}
        >
          {t("Clear")}
        </Button>
      </Group>
    </Stack>
  );
}
