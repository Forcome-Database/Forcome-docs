import { Group, Text } from "@mantine/core";
import { IconUser } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import type { AgentMessage } from "../../types/agent-v2.types";
import classes from "./agent-panel.module.css";

interface UserMessageProps {
  message: AgentMessage;
}

export function UserMessage({ message }: UserMessageProps) {
  const { t } = useTranslation();
  return (
    <div className={classes.userMessage}>
      <Group gap={8} mb={4}>
        <div className={classes.userAvatar}>
          <IconUser size={13} />
        </div>
        <Text size="sm" fw={600}>
          {t("You")}
        </Text>
      </Group>
      <Text size="sm" ml={30}>
        {message.content}
      </Text>
      {message.files && message.files.length > 0 && (
        <Group gap={4} mt={6} ml={30}>
          {message.files.map((name) => (
            <span key={name} className={classes.fileBadge}>
              {name}
            </span>
          ))}
        </Group>
      )}
      {message.selectionSnapshot && message.selectionSnapshot.preview && (
        <Group gap={4} mt={6} ml={30}>
          <span className={classes.fileBadge}>
            {message.selectionSnapshot.mode === "insert" ? "📍 " : "✂️ "}
            {message.selectionSnapshot.preview.length > 60
              ? message.selectionSnapshot.preview.substring(0, 60) + "..."
              : message.selectionSnapshot.preview}
          </span>
        </Group>
      )}
    </div>
  );
}
