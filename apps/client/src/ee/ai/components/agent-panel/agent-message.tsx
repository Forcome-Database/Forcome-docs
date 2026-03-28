import { useState } from "react";
import { Alert, Box, Collapse, Group, Loader, Stack, Text, ThemeIcon, UnstyledButton } from "@mantine/core";
import {
  IconAlertTriangle,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconBulb,
  IconListDetails,
} from "@tabler/icons-react";
import type { AgentMessage as AgentMessageType, TimelineItem } from "../../types/agent-v2.types";
import { StreamingMarkdown } from "./streaming-markdown";
import classes from "./agent-panel.module.css";

interface AgentMessageProps {
  message: AgentMessageType;
}

/** Strip markdown formatting symbols for clean summary display */
function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/_(.+?)_/g, "$1")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/^#+\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "");
}

function NarrationBlock({ content }: { content: string }) {
  const [opened, setOpened] = useState(false);
  const rawSummary = content.split("\n").filter((l) => l.trim()).slice(0, 2).join(" ");
  const summary = stripMarkdown(rawSummary);

  return (
    <Box className={classes.narrationBlock}>
      <UnstyledButton onClick={() => setOpened((o) => !o)} className={classes.narrationToggle}>
        <Group gap={6}>
          {opened ? <IconChevronDown size={13} /> : <IconChevronRight size={13} />}
          <IconListDetails size={13} className={classes.narrationIcon} />
          <Text size="xs" c="dimmed" fw={500}>
            {"规划"}
          </Text>
        </Group>
      </UnstyledButton>
      {!opened && summary && (
        <Text size="xs" c="dimmed" lineClamp={2} ml={26} mt={2}>
          {summary}
        </Text>
      )}
      <Collapse in={opened}>
        <div className={classes.narrationContent}>{content}</div>
      </Collapse>
    </Box>
  );
}

function ThinkingBlock({ content, label }: { content: string; label?: string }) {
  const [opened, setOpened] = useState(false);
  const rawSummary = content.split("\n").filter((l) => l.trim()).slice(0, 2).join(" ");
  const summary = stripMarkdown(rawSummary);
  const displayLabel = label || "思考";

  if (!content.trim()) return null;

  return (
    <Box className={classes.thinkingBlock}>
      <UnstyledButton onClick={() => setOpened((o) => !o)} className={classes.thinkingToggle}>
        <Group gap={6}>
          {opened ? <IconChevronDown size={13} /> : <IconChevronRight size={13} />}
          <IconBulb size={13} className={classes.thinkingIcon} />
          <Text size="xs" c="dimmed" fw={500}>
            {displayLabel}
          </Text>
        </Group>
      </UnstyledButton>
      {!opened && summary && (
        <Text size="xs" c="dimmed" lineClamp={2} ml={26} mt={2}>
          {summary}
        </Text>
      )}
      <Collapse in={opened}>
        <div className={classes.thinkingContent}>{content}</div>
      </Collapse>
    </Box>
  );
}

function ToolItem({ item }: { item: Extract<TimelineItem, { kind: "tool" }> }) {
  const isDone = item.status !== "running";

  return (
    <div className={`${classes.toolItem} ${isDone ? classes.toolItemDone : ""}`}>
      {item.status === "running" ? (
        <Loader size={14} color="#6366f1" />
      ) : (
        <ThemeIcon size={20} radius="xl" color="teal" variant="light">
          <IconCheck size={12} />
        </ThemeIcon>
      )}
      <Text size="xs" c="dimmed" fw={isDone ? 400 : 500}>
        {item.description}
      </Text>
    </div>
  );
}

export function AgentMessage({ message }: AgentMessageProps) {
  const timeline = message.timeline ?? [];

  return (
    <div className={classes.agentMessage}>
      <Stack gap={8}>
        {timeline.map((item, i) => {
          switch (item.kind) {
            case "thinking":
              return <ThinkingBlock key={`t-${i}`} content={item.content} />;

            case "tool":
              return <ToolItem key={item.id} item={item} />;

            case "text":
              if (item.isNarration) {
                return <NarrationBlock key={`n-${i}`} content={item.content} />;
              }
              return (
                <StreamingMarkdown
                  key={`c-${i}`}
                  content={item.content}
                  streaming={message.streaming}
                />
              );

            default:
              return null;
          }
        })}

        {message.streaming && (
          <div className={classes.workingIndicator}>
            <div className={classes.dotPulse}>
              <span />
              <span />
              <span />
            </div>
            <Text size="xs" c="dimmed">
              {"Agent 正在工作..."}
            </Text>
          </div>
        )}

        {message.warnings && message.warnings.length > 0 && (
          <Alert
            icon={<IconAlertTriangle size={16} />}
            color="yellow"
            variant="light"
            p="xs"
            className={classes.warningAlert}
          >
            {message.warnings.map((w, i) => (
              <Text key={i} size="xs">
                {w}
              </Text>
            ))}
          </Alert>
        )}
      </Stack>
    </div>
  );
}
