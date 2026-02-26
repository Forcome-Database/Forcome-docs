import { Box, Text, Group } from "@mantine/core";
import { IconSparkles } from "@tabler/icons-react";
import { useAtom, useAtomValue } from "jotai";
import { useParams } from "react-router-dom";
import { extractPageSlugId } from "@/lib";
import {
  aiCreatorMessagesAtom,
  aiCreatorStreamingAtom,
} from "./ai-creator-atoms";
import { AiCreatorMessageItem } from "./ai-creator-message-item";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import classes from "./ai-creator.module.css";

export function AiCreatorMessages() {
  const { t } = useTranslation();
  const { pageSlug } = useParams();
  const pageId = extractPageSlugId(pageSlug);
  const [allMessages] = useAtom(aiCreatorMessagesAtom);
  const isStreaming = useAtomValue(aiCreatorStreamingAtom);
  const messages = allMessages[pageId] || [];
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, messages[messages.length - 1]?.content]);

  if (messages.length === 0) {
    return (
      <div className={classes.messagesEmpty}>
        <IconSparkles size={36} stroke={1.2} color="var(--mantine-color-gray-4)" />
        <Text size="sm" c="dimmed" ta="center">
          {t("Start creating with AI")}
        </Text>
        <Text size="xs" c="dimmed" ta="center" lh={1.6} opacity={0.7}>
          {t("Upload files as reference material")}<br />
          {t("Select a template or describe freely")}<br />
          {t("AI writes directly into the editor")}
        </Text>
      </div>
    );
  }

  return (
    <Box px={4} py="xs">
      {messages.map((msg) => (
        <AiCreatorMessageItem key={msg.id} message={msg} />
      ))}
      {isStreaming && (
        <Group gap={8} p="xs">
          <Group gap={3}>
            <span className={classes.streamingDot} />
            <span className={classes.streamingDot} />
            <span className={classes.streamingDot} />
          </Group>
          <Text size="xs" c="dimmed">
            {t("AI is writing...")}
          </Text>
        </Group>
      )}
      <div ref={bottomRef} />
    </Box>
  );
}
