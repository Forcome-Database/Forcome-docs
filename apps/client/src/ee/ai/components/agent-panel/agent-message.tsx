import { useCallback, useState } from "react";
import { Alert, Box, Collapse, Group, Loader, Stack, Text, ThemeIcon, UnstyledButton } from "@mantine/core";
import { IconAlertTriangle, IconCheck, IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import type { AgentMessage as AgentMessageType, TimelineItem } from "../../types/agent-v2.types";
import { StreamingMarkdown } from "./streaming-markdown";
import classes from "./agent-panel.module.css";

interface AgentMessageProps {
  message: AgentMessageType;
}

/** 时间线中的规划/叙述块（可折叠） */
function NarrationBlock({ content }: { content: string }) {
  const [opened, setOpened] = useState(false);
  const summary = content.split("\n").filter((l) => l.trim()).slice(0, 2).join(" ");

  return (
    <Box>
      <UnstyledButton onClick={() => setOpened((o) => !o)} className={classes.thinkingToggle}>
        <Group gap={6}>
          {opened ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
          <Text size="xs" c="dimmed">规划</Text>
        </Group>
      </UnstyledButton>
      {!opened && summary && (
        <Text size="xs" c="dimmed" lineClamp={2} ml={20}>{summary}</Text>
      )}
      <Collapse in={opened}>
        <Text size="xs" c="dimmed" className={classes.thinkingContent}>{content}</Text>
      </Collapse>
    </Box>
  );
}

/** 时间线中的思考块（可折叠） */
function ThinkingBlock({ content, label }: { content: string; label?: string }) {
  const [opened, setOpened] = useState(false);
  const summary = content.split("\n").filter((l) => l.trim()).slice(0, 2).join(" ");
  const displayLabel = label || "思考";

  if (!content.trim()) return null;

  return (
    <Box>
      <UnstyledButton onClick={() => setOpened((o) => !o)} className={classes.thinkingToggle}>
        <Group gap={6}>
          {opened ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
          <Text size="xs" c="dimmed">{displayLabel}</Text>
        </Group>
      </UnstyledButton>
      {!opened && summary && (
        <Text size="xs" c="dimmed" lineClamp={2} ml={20}>{summary}</Text>
      )}
      <Collapse in={opened}>
        <Text size="xs" c="dimmed" className={classes.thinkingContent}>{content}</Text>
      </Collapse>
    </Box>
  );
}

/** 时间线中的工具调用步骤 */
function ToolItem({ item }: { item: Extract<TimelineItem, { kind: "tool" }> }) {
  return (
    <Group gap={8} py={2}>
      {item.status === "running" ? (
        <Loader size={14} />
      ) : (
        <ThemeIcon size={18} radius="xl" color="teal" variant="light">
          <IconCheck size={12} />
        </ThemeIcon>
      )}
      <Text size="xs" c="dimmed">{item.description}</Text>
    </Group>
  );
}

export function AgentMessage({ message }: AgentMessageProps) {
  const timeline = message.timeline ?? [];
  const hasDocument = timeline.some((item) => item.kind === "text" && !item.isNarration && item.content);

  return (
    <div className={classes.agentMessage}>
      <Stack gap={4}>
        {/* 按到达顺序渲染时间线 */}
        {timeline.map((item, i) => {
          switch (item.kind) {
            case "thinking":
              return <ThinkingBlock key={`t-${i}`} content={item.content} />;

            case "tool":
              return <ToolItem key={item.id} item={item} />;

            case "text":
              if (item.isNarration) {
                // 被 tool_call 回溯降级的叙述 → 折叠规划块
                return <NarrationBlock key={`n-${i}`} content={item.content} />;
              }
              // 最终文档内容 → 流式 Markdown
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

        {/* 工作指示器：streaming 期间始终显示，直到文档完全写完 */}
        {message.streaming && (
          <Group gap={6} py={4}>
            <Loader size={14} />
            <Text size="xs" c="dimmed">Agent 正在工作...</Text>
          </Group>
        )}

        {/* 警告 */}
        {message.warnings && message.warnings.length > 0 && (
          <Alert
            icon={<IconAlertTriangle size={16} />}
            color="yellow"
            variant="light"
            p="xs"
          >
            {message.warnings.map((w, i) => (
              <Text key={i} size="xs">{w}</Text>
            ))}
          </Alert>
        )}
      </Stack>
    </div>
  );
}
