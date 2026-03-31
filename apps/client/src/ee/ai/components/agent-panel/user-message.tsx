import { Group, Text } from "@mantine/core";
import { useAtomValue } from "jotai";
import { currentUserAtom } from "@/features/user/atoms/current-user-atom";
import { CustomAvatar } from "@/components/ui/custom-avatar";
import type { AgentMessage } from "../../types/agent-v2.types";
import classes from "./agent-panel.module.css";

interface UserMessageProps {
  message: AgentMessage;
}

export function UserMessage({ message }: UserMessageProps) {
  const currentUser = useAtomValue(currentUserAtom);
  const userName = currentUser?.user?.name || "You";
  const avatarUrl = currentUser?.user?.avatarUrl || "";
  return (
    <div className={classes.userMessage}>
      <Group gap={8} mb={4}>
        <CustomAvatar
          avatarUrl={avatarUrl}
          name={userName}
          size={22}
          radius="xl"
        />
        <Text size="sm" fw={600}>
          {userName}
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
