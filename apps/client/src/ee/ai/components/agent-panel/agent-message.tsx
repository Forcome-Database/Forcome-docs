import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Box, Collapse, Group, Loader, Stack, Text, UnstyledButton } from "@mantine/core";
import { IconAlertTriangle, IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import type { AgentMessage as AgentMessageType } from "../../types/agent-v2.types";
import { ToolCallStep } from "./tool-call-step";
import { StreamingMarkdown } from "./streaming-markdown";
import classes from "./agent-panel.module.css";

interface AgentMessageProps {
  message: AgentMessageType;
}

/**
 * 思考计时器 — 工具完成到内容开始之间的等待时间。
 * 不依赖模型返回 thinking 事件（OpenAI 不返回），纯前端计时。
 */
function useThinkingTimer(isActivelyThinking: boolean) {
  const [elapsed, setElapsed] = useState(0);
  const [finalTime, setFinalTime] = useState<number | null>(null);
  const startRef = useRef<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (isActivelyThinking) {
      // 开始计时
      if (startRef.current === null) {
        startRef.current = Date.now();
        setFinalTime(null);
      }
      intervalRef.current = setInterval(() => {
        if (startRef.current !== null) {
          setElapsed(((Date.now() - startRef.current) / 1000));
        }
      }, 100);
    } else if (startRef.current !== null) {
      // 思考结束，冻结时间
      setFinalTime((Date.now() - startRef.current) / 1000);
      startRef.current = null;
      if (intervalRef.current) clearInterval(intervalRef.current);
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isActivelyThinking]);

  return { elapsed, finalTime, wasThinking: finalTime !== null };
}

export function AgentMessage({ message }: AgentMessageProps) {
  const [openPhases, setOpenPhases] = useState<Set<number>>(new Set());

  const togglePhase = useCallback((phase: number) => {
    setOpenPhases((prev) => {
      const next = new Set(prev);
      if (next.has(phase)) {
        next.delete(phase);
      } else {
        next.add(phase);
      }
      return next;
    });
  }, []);

  const allToolsDone = message.toolSteps?.length
    ? message.toolSteps.every((s) => s.status === "done")
    : false;
  const isActivelyThinking =
    !!message.streaming && !message.content && allToolsDone;

  const { elapsed, finalTime, wasThinking } = useThinkingTimer(isActivelyThinking);
  const phases = message.thinkingPhases ?? [];
  const hasThinkingContent = phases.length > 0;

  // 显示条件：正在思考 OR 思考过（有计时 OR 有内容）
  const showThinkingSection = isActivelyThinking || wasThinking || hasThinkingContent;

  return (
    <div className={classes.agentMessage}>
      <Stack gap={4}>
        {message.toolSteps?.map((step) => (
          <ToolCallStep key={step.id} step={step} />
        ))}

        {showThinkingSection && (
          <div>
            {phases.length === 0 ? (
              /* 无内容但正在思考（纯计时） */
              <UnstyledButton className={classes.thinkingToggle}>
                <Group gap={6}>
                  {isActivelyThinking && <Loader size={14} />}
                  <Text size="xs" c="dimmed">
                    {isActivelyThinking
                      ? `已思考 ${elapsed.toFixed(1)}s ...`
                      : `已思考 ${(finalTime ?? 0).toFixed(1)}s`}
                  </Text>
                </Group>
              </UnstyledButton>
            ) : (
              /* 多阶段思考 — 每个阶段独立可折叠 */
              phases.map((phase) => {
                const isLast = phase.phase === phases[phases.length - 1]?.phase;
                const isPhaseOpen = openPhases.has(phase.phase);
                const label = isLast ? "最终分析" : `思考阶段 ${phase.phase}`;
                const summary = phase.content
                  .split("\n")
                  .filter((l) => l.trim())
                  .slice(0, 2)
                  .join(" ");

                return (
                  <Box key={phase.phase} mb={4}>
                    <UnstyledButton
                      onClick={() => phase.content && togglePhase(phase.phase)}
                      className={classes.thinkingToggle}
                    >
                      <Group gap={6}>
                        {isLast && isActivelyThinking ? (
                          <Loader size={14} />
                        ) : phase.content ? (
                          isPhaseOpen ? (
                            <IconChevronDown size={14} />
                          ) : (
                            <IconChevronRight size={14} />
                          )
                        ) : null}
                        <Text size="xs" c="dimmed">
                          {isLast && isActivelyThinking
                            ? `${label} ${elapsed.toFixed(1)}s ...`
                            : isLast
                              ? `${label} ${(finalTime ?? 0).toFixed(1)}s`
                              : label}
                        </Text>
                      </Group>
                    </UnstyledButton>
                    {/* 折叠态：显示摘要 */}
                    {!isPhaseOpen && summary && (
                      <Text size="xs" c="dimmed" lineClamp={2} ml={20}>
                        {summary}
                      </Text>
                    )}
                    {/* 展开态：显示完整内容 */}
                    <Collapse in={isPhaseOpen}>
                      <Text
                        size="xs"
                        c="dimmed"
                        className={classes.thinkingContent}
                      >
                        {phase.content}
                      </Text>
                    </Collapse>
                  </Box>
                );
              })
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
