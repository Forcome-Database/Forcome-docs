import { Box, Text, Group, SimpleGrid, Paper, ThemeIcon } from "@mantine/core";
import {
  IconSparkles,
  IconFileCode,
  IconBook,
  IconClipboardList,
  IconChartBar,
  IconNotes,
  IconChecklist,
} from "@tabler/icons-react";
import { useAtom, useAtomValue } from "jotai";
import { useParams } from "react-router-dom";
import { extractPageSlugId } from "@/lib";
import {
  aiCreatorMessagesAtom,
  aiCreatorStreamingAtom,
  aiCreatorTemplateAtom,
} from "./ai-creator-atoms";
import { AiCreatorMessageItem } from "./ai-creator-message-item";
import { AI_TEMPLATE_OPTIONS } from "./ai-creator.types";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
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
    // Focus the input textarea
    setTimeout(() => {
      const textarea = document.querySelector('[data-ai-input]') as HTMLTextAreaElement;
      textarea?.focus();
    }, 50);
  };

  return (
    <div className={classes.welcomePage}>
      <div className={classes.welcomeHeader}>
        <div className={classes.welcomeAvatar}>
          <IconSparkles size={24} />
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
              <ThemeIcon
                variant="light"
                color="indigo"
                size="md"
                radius="md"
                mb={6}
              >
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
    return <WelcomePage />;
  }

  return (
    <Box px="sm" py="xs">
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
