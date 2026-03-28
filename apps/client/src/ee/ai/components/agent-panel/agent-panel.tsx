import { useCallback, useRef } from "react";
import { ActionIcon, Group, Text, Tooltip } from "@mantine/core";
import { IconPlus, IconSparkles, IconX } from "@tabler/icons-react";
import { useAtom, useAtomValue } from "jotai";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { notifications } from "@mantine/notifications";

import { asideStateAtom } from "@/components/layouts/global/hooks/atoms/sidebar-atom";
import {
  pageEditorAtom,
  titleEditorAtom,
} from "@/features/editor/atoms/editor-atoms";
import { extractPageSlugId } from "@/lib";
import { maybeExtractTitle } from "../ai-creator/ai-creator-writeback";
import { htmlToMarkdown } from "@docmost/editor-ext";
import { safeApply } from "../../utils/safe-apply";

import { useAgentSession } from "../../hooks/use-agent-session";
import { MessageList } from "./message-list";
import { ActionBar } from "./action-bar";
import { InputBar } from "./input-bar";
import classes from "./agent-panel.module.css";

export default function AgentPanel() {
  const { t } = useTranslation();
  const [, setAside] = useAtom(asideStateAtom);
  const editor = useAtomValue(pageEditorAtom);
  const titleEditor = useAtomValue(titleEditorAtom);
  const { pageSlug } = useParams();
  const pageId = extractPageSlugId(pageSlug);

  const session = useAgentSession(pageId);

  const closePanel = () => setAside({ tab: "", isAsideOpen: false });

  const lastSnapshotRef = useRef<any>(null);

  const handleApply = useCallback(async () => {
    if (!session.lastOutput || !editor) return;

    const markdown = titleEditor
      ? maybeExtractTitle(titleEditor, session.lastOutput)
      : session.lastOutput;

    const result = await safeApply({
      editor,
      titleEditor,
      markdown,
      mode: "full",
    });

    if (result.ok) {
      lastSnapshotRef.current = result.snapshot;
      notifications.show({
        message: t("Applied to page"),
        color: "green",
        autoClose: 5000,
      });
    } else {
      notifications.show({
        message: `${t("Failed to apply")}: ${result.reason}`,
        color: "red",
      });
    }
  }, [session.lastOutput, editor, titleEditor, t]);

  /** Get current page content as markdown to send as context on follow-up turns */
  const getPageContent = useCallback((): string | undefined => {
    if (!editor) return undefined;
    try {
      return htmlToMarkdown(editor.getHTML());
    } catch {
      return undefined;
    }
  }, [editor]);

  const handleSubmit = useCallback(
    (prompt: string, files?: File[]) => {
      // Send page content as context on follow-up turns (when threadId exists)
      const pageContent = session.threadId ? getPageContent() : undefined;
      session.submit(prompt, files, pageContent);
    },
    [session.threadId, session.submit, getPageContent],
  );

  const handleRegenerate = useCallback(() => {
    const lastUserMsg = [...session.messages]
      .reverse()
      .find((m) => m.role === "user");
    if (lastUserMsg) {
      const pageContent = getPageContent();
      session.submit(lastUserMsg.content, undefined, pageContent);
    }
  }, [session.messages, session.submit, getPageContent]);

  const isDone = session.status === "done";
  const isStreaming =
    session.status === "streaming" || session.status === "thinking";

  return (
    <div className={classes.panelRoot}>
      <Group className={classes.panelHeader} justify="space-between" px="sm" py={8}>
        <Group gap={8}>
          <IconSparkles size={18} className={classes.headerIcon} />
          <Text size="sm" fw={600}>
            {t("AI Agent")}
          </Text>
        </Group>
        <Group gap={4}>
          <Tooltip label={t("New conversation")}>
            <ActionIcon variant="subtle" size="sm" onClick={session.reset}>
              <IconPlus size={16} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={t("Close")}>
            <ActionIcon variant="subtle" size="sm" onClick={closePanel}>
              <IconX size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>

      <MessageList messages={session.messages} />

      {isDone && session.lastOutput && session.outputType === "document" && (
        <ActionBar
          onApply={handleApply}
          onRegenerate={handleRegenerate}
          content={session.lastOutput}
        />
      )}

      <InputBar
        onSubmit={handleSubmit}
        onCancel={session.cancel}
        isStreaming={isStreaming}
      />
    </div>
  );
}
