import { Modal, Button, Group, Text } from "@mantine/core";
import { useState, useEffect } from "react";
import { notifications } from "@mantine/notifications";
import { useTranslation } from "react-i18next";
import { DirectorySelect } from "@/features/directory/components/directory-select";
import { TopicSelect } from "@/features/topic/components/topic-select";
import { categorizePage } from "@/features/page/services/page-service";
import { queryClient } from "@/main";
import { invalidateDirectoryTopicQueries } from "@/features/page/queries/page-query";

interface CategorizePageModalProps {
  pageId: string;
  spaceId: string;
  currentDirectoryId?: string | null;
  currentTopicId?: string | null;
  open: boolean;
  onClose: () => void;
}

export default function CategorizePageModal({
  pageId,
  spaceId,
  currentDirectoryId,
  currentTopicId,
  open,
  onClose,
}: CategorizePageModalProps) {
  const { t } = useTranslation();
  const [directoryId, setDirectoryId] = useState<string | null>(
    currentDirectoryId || null,
  );
  const [topicId, setTopicId] = useState<string | null>(
    currentTopicId || null,
  );

  useEffect(() => {
    if (open) {
      setDirectoryId(currentDirectoryId || null);
      setTopicId(currentTopicId || null);
    }
  }, [open, currentDirectoryId, currentTopicId]);

  const handleDirectoryChange = (dirId: string | null) => {
    setDirectoryId(dirId);
    setTopicId(null);
  };

  const handleSave = async () => {
    try {
      await categorizePage({ pageId, directoryId, topicId });
      // Refresh page data and breadcrumbs
      queryClient.invalidateQueries({
        predicate: (item) =>
          ["pages", "breadcrumbs"].includes(item.queryKey[0] as string),
      });
      // Refresh the main tree (page may have moved in/out of uncategorized)
      queryClient.invalidateQueries({ queryKey: ["root-sidebar-pages"] });
      // Refresh old and new directory/topic sections
      if (currentDirectoryId) {
        invalidateDirectoryTopicQueries(spaceId, currentDirectoryId, currentTopicId);
      }
      if (directoryId) {
        invalidateDirectoryTopicQueries(spaceId, directoryId, topicId);
      }
      notifications.show({ message: t("Page categorized successfully") });
      onClose();
    } catch (err: any) {
      notifications.show({
        message: err.response?.data?.message || "An error occurred",
        color: "red",
      });
    }
  };

  return (
    <Modal.Root
      opened={open}
      onClose={onClose}
      size={400}
      padding="xl"
      yOffset="10vh"
      onClick={(e) => e.stopPropagation()}
    >
      <Modal.Overlay />
      <Modal.Content style={{ overflow: "hidden" }}>
        <Modal.Header py={0}>
          <Modal.Title fw={500}>{t("Categorize page")}</Modal.Title>
          <Modal.CloseButton />
        </Modal.Header>
        <Modal.Body>
          <Text mb="xs" c="dimmed" size="sm">
            {t("Assign this page to a directory and topic.")}
          </Text>

          <DirectorySelect
            spaceId={spaceId}
            value={directoryId}
            onChange={handleDirectoryChange}
          />

          <TopicSelect
            directoryId={directoryId}
            value={topicId}
            onChange={setTopicId}
          />

          <Group justify="end" mt="md">
            <Button onClick={onClose} variant="default">
              {t("Cancel")}
            </Button>
            <Button onClick={handleSave}>{t("Save")}</Button>
          </Group>
        </Modal.Body>
      </Modal.Content>
    </Modal.Root>
  );
}
