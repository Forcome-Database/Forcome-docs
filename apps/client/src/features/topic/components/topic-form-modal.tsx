import { Modal, TextInput, Textarea, Button, Stack } from "@mantine/core";
import { useForm } from "@mantine/form";
import { useTranslation } from "react-i18next";
import {
  useCreateTopicMutation,
  useUpdateTopicMutation,
} from "../queries/topic-query";
import { ITopic } from "../types/topic.types";
import { useEffect } from "react";

interface TopicFormModalProps {
  opened: boolean;
  onClose: () => void;
  directoryId: string;
  topic?: ITopic | null;
}

export function TopicFormModal({
  opened,
  onClose,
  directoryId,
  topic,
}: TopicFormModalProps) {
  const { t } = useTranslation();
  const createMutation = useCreateTopicMutation();
  const updateMutation = useUpdateTopicMutation();
  const isEdit = !!topic;

  const form = useForm({
    initialValues: { name: "", description: "" },
  });

  useEffect(() => {
    if (opened) {
      if (topic) {
        form.setValues({
          name: topic.name,
          description: topic.description || "",
        });
      } else {
        form.reset();
      }
    }
  }, [topic, opened]);

  const handleSubmit = form.onSubmit(async (values) => {
    if (isEdit) {
      await updateMutation.mutateAsync({
        topicId: topic.id,
        ...values,
      });
    } else {
      await createMutation.mutateAsync({ ...values, directoryId });
    }
    onClose();
    form.reset();
  });

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={isEdit ? t("Edit topic") : t("Create topic")}
      size="md"
    >
      <form onSubmit={handleSubmit}>
        <Stack>
          <TextInput
            label={t("Name")}
            required
            {...form.getInputProps("name")}
          />
          <Textarea
            label={t("Description")}
            {...form.getInputProps("description")}
          />
          <Button
            type="submit"
            loading={createMutation.isPending || updateMutation.isPending}
          >
            {isEdit ? t("Save") : t("Create")}
          </Button>
        </Stack>
      </form>
    </Modal>
  );
}
