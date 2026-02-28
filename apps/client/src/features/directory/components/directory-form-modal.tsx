import { Modal, TextInput, Textarea, Button, Stack } from "@mantine/core";
import { useForm } from "@mantine/form";
import { useTranslation } from "react-i18next";
import {
  useCreateDirectoryMutation,
  useUpdateDirectoryMutation,
} from "../queries/directory-query";
import { IDirectory } from "../types/directory.types";
import { useEffect } from "react";

interface DirectoryFormModalProps {
  opened: boolean;
  onClose: () => void;
  spaceId: string;
  directory?: IDirectory | null;
}

export function DirectoryFormModal({
  opened,
  onClose,
  spaceId,
  directory,
}: DirectoryFormModalProps) {
  const { t } = useTranslation();
  const createMutation = useCreateDirectoryMutation();
  const updateMutation = useUpdateDirectoryMutation();
  const isEdit = !!directory;

  const form = useForm({
    initialValues: { name: "", description: "" },
  });

  useEffect(() => {
    if (opened) {
      if (directory) {
        form.setValues({
          name: directory.name,
          description: directory.description || "",
        });
      } else {
        form.reset();
      }
    }
  }, [directory, opened]);

  const handleSubmit = form.onSubmit(async (values) => {
    if (isEdit) {
      await updateMutation.mutateAsync({
        directoryId: directory.id,
        ...values,
      });
    } else {
      await createMutation.mutateAsync({ ...values, spaceId });
    }
    onClose();
    form.reset();
  });

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={isEdit ? t("Edit directory") : t("Create directory")}
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
