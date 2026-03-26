import { Badge, Group, Text } from "@mantine/core";
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
        <IconUser size={16} />
        <Text size="sm" fw={500}>{t("You")}</Text>
      </Group>
      <Text size="sm">{message.content}</Text>
      {message.files && message.files.length > 0 && (
        <Group gap={4} mt={4}>
          {message.files.map((name) => (
            <Badge key={name} size="xs" variant="light">
              {name}
            </Badge>
          ))}
        </Group>
      )}
    </div>
  );
}
