import { useEffect, useRef } from "react";
import { ScrollArea, Stack, Text } from "@mantine/core";
import { IconSparkles } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import type { AgentMessage as AgentMessageType } from "../../types/agent-v2.types";
import { UserMessage } from "./user-message";
import { AgentMessage } from "./agent-message";
import classes from "./agent-panel.module.css";

interface MessageListProps {
  messages: AgentMessageType[];
}

export function MessageList({ messages }: MessageListProps) {
  const { t } = useTranslation();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className={classes.emptyState}>
        <IconSparkles size={32} opacity={0.3} />
        <Text size="sm" c="dimmed" ta="center" mt="sm">
          {t("Describe what you want to create, or upload a document to get started.")}
        </Text>
      </div>
    );
  }

  return (
    <ScrollArea className={classes.messageList} offsetScrollbars>
      <Stack gap="md" p="sm">
        {messages.map((msg) =>
          msg.role === "user" ? (
            <UserMessage key={msg.id} message={msg} />
          ) : (
            <AgentMessage key={msg.id} message={msg} />
          ),
        )}
        <div ref={bottomRef} />
      </Stack>
    </ScrollArea>
  );
}
