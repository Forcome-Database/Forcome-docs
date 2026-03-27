import { useState } from "react";
import { Alert, Collapse, Group, Loader, Stack, Text, UnstyledButton } from "@mantine/core";
import { IconAlertTriangle, IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import type { AgentMessage as AgentMessageType } from "../../types/agent-v2.types";
import { ToolCallStep } from "./tool-call-step";
import { StreamingMarkdown } from "./streaming-markdown";
import classes from "./agent-panel.module.css";

interface AgentMessageProps {
  message: AgentMessageType;
}

export function AgentMessage({ message }: AgentMessageProps) {
  const [thinkingOpen, setThinkingOpen] = useState(false);

  const allToolsDone = message.toolSteps?.length
    ? message.toolSteps.every((s) => s.status === "done")
    : false;
  const isThinking =
    message.streaming && !message.content && allToolsDone;
  const hasThinkingContent = !!message.thinkingContent;

  return (
    <div className={classes.agentMessage}>
      <Stack gap={4}>
        {message.toolSteps?.map((step) => (
          <ToolCallStep key={step.id} step={step} />
        ))}

        {/* Thinking indicator: spinner while thinking, collapsible when content available */}
        {(isThinking || hasThinkingContent) && (
          <div>
            <UnstyledButton
              onClick={() => setThinkingOpen((o) => !o)}
              className={classes.thinkingToggle}
            >
              <Group gap={6}>
                {isThinking ? (
                  <Loader size={14} />
                ) : (
                  thinkingOpen ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />
                )}
                <Text size="xs" c="dimmed">
                  {isThinking
                    ? "正在思考与组织内容..."
                    : `已思考`}
                </Text>
              </Group>
            </UnstyledButton>
            {hasThinkingContent && (
              <Collapse in={thinkingOpen}>
                <Text
                  size="xs"
                  c="dimmed"
                  className={classes.thinkingContent}
                >
                  {message.thinkingContent}
                </Text>
              </Collapse>
            )}
          </div>
        )}

        {message.content && (
          <StreamingMarkdown
            content={message.content}
            streaming={message.streaming}
          />
        )}

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
