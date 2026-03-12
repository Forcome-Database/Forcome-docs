import { Box, Group, Paper, SimpleGrid, Text, ThemeIcon } from "@mantine/core";
import {
  IconBook,
  IconChartBar,
  IconChecklist,
  IconClipboardList,
  IconFileCode,
  IconNotes,
} from "@tabler/icons-react";
import { useAtom, useAtomValue } from "jotai";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { AgentStepInfo } from "@/ee/ai/types/agent.types";
import { agentModeAtom, aiCreatorTemplateAtom } from "./ai-creator-atoms";
import { AiCreatorMessageItem } from "./ai-creator-message-item";
import type { AiCreatorMessage } from "./ai-creator.types";
import { AI_TEMPLATE_OPTIONS } from "./ai-creator.types";
import classes from "./ai-creator.module.css";

const ICON_MAP: Record<string, React.ComponentType<any>> = {
  IconFileCode,
  IconBook,
  IconClipboardList,
  IconChartBar,
  IconNotes,
  IconChecklist,
};

function WelcomePage() {
  const { t } = useTranslation();
  const [, _setTemplate] = useAtom(aiCreatorTemplateAtom);
  const setTemplate = _setTemplate as (v: string | null) => void;

  const handleTemplateClick = (key: string) => {
    setTemplate(key);
    setTimeout(() => {
      const textarea = document.querySelector("[data-ai-input]") as HTMLTextAreaElement;
      textarea?.focus();
    }, 50);
  };

  return (
    <div className={classes.welcomePage}>
      <div className={classes.welcomeHeader}>
        <div className={classes.welcomeAvatar}>
          <img src="/icons/app-icon-192x192.png" alt="" width={80} height={80} />
        </div>
        <Text size="lg" fw={600} mt="sm">
          {t("AI Assistant")}
        </Text>
        <Text size="sm" c="dimmed" ta="center" mt={4}>
          {t("Choose a template or describe freely to start creating")}
        </Text>
      </div>

      <SimpleGrid cols={2} spacing="sm" className={classes.templateGrid}>
        {AI_TEMPLATE_OPTIONS.map((tmpl) => {
          const Icon = ICON_MAP[tmpl.icon] || IconFileCode;
          return (
            <Paper
              key={tmpl.key}
              className={classes.templateCard}
              p="sm"
              radius="md"
              onClick={() => handleTemplateClick(tmpl.key)}
            >
              <ThemeIcon variant="light" color="indigo" size="md" radius="md" mb={6}>
                <Icon size={16} />
              </ThemeIcon>
              <Text size="sm" fw={500} lh={1.3}>
                {t(tmpl.name)}
              </Text>
              <Text size="xs" c="dimmed" lh={1.4} mt={2}>
                {t(tmpl.desc)}
              </Text>
            </Paper>
          );
        })}
      </SimpleGrid>
    </div>
  );
}

interface AiCreatorMessagesProps {
  messages: AiCreatorMessage[];
  isStreaming: boolean;
  agentSteps: AgentStepInfo[];
  onResume: (value: Record<string, any>) => void;
}

export function AiCreatorMessages({
  messages,
  isStreaming,
  agentSteps,
  onResume,
}: AiCreatorMessagesProps) {
  const { t } = useTranslation();
  const agentMode = useAtomValue(agentModeAtom);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, messages[messages.length - 1]?.content]);

  if (messages.length === 0) {
    return <WelcomePage />;
  }

  return (
    <Box px="sm" py="xs">
      {messages.map((msg, idx) => (
        <AiCreatorMessageItem
          key={msg.id}
          message={msg}
          isLast={idx === messages.length - 1}
          onResume={onResume}
          showAgentSteps={agentMode}
          agentSteps={agentSteps}
        />
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
