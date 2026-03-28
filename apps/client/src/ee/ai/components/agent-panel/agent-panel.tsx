import { useCallback } from "react";
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
import { usePageQuery } from "@/features/page/queries/page-query";
import { maybeExtractTitle } from "../ai-creator/ai-creator-writeback";
import {
  captureAiCreatePageSnapshot,
  commitDraftWithRecovery,
} from "../../hooks/ai-create-session.commit";
import { creatorCommit } from "../../services/ai-service";
import api from "@/lib/api-client";

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
  const { data: page } = usePageQuery({ pageId });

  const session = useAgentSession(pageId);

  const closePanel = () => setAside({ tab: "", isAsideOpen: false });

  const handleApply = useCallback(async () => {
    if (!session.lastOutput || !editor || !pageId) return;

    try {
      const markdown = titleEditor
        ? maybeExtractTitle(titleEditor, session.lastOutput)
        : session.lastOutput;

      const snapshot = captureAiCreatePageSnapshot(editor, titleEditor);
      const result = await commitDraftWithRecovery({
        pageId,
        content: markdown,
        insertMode: "overwrite",
        expectedUpdatedAt: page?.updatedAt
          ? new Date(page.updatedAt).toISOString()
          : null,
        pageSnapshot: snapshot,
        editor,
        titleEditor,
        commit: creatorCommit,
        fetchLatestPage: async (id) => {
          const res = await api.post("/pages/info", { pageId: id });
          return res.data;
        },
      });

      if (result.ok) {
        notifications.show({ message: t("Applied to page"), color: "green" });
      } else {
        const failResult = result as { ok: false; reason: string };
        notifications.show({
          message: `${t("Failed to apply")}: ${failResult.reason}`,
          color: "red",
        });
      }
    } catch {
      notifications.show({ message: t("Failed to apply"), color: "red" });
    }
  }, [session.lastOutput, editor, titleEditor, pageId, page?.updatedAt, t]);

  const handleRegenerate = useCallback(() => {
    const lastUserMsg = [...session.messages]
      .reverse()
      .find((m) => m.role === "user");
    if (lastUserMsg) {
      session.submit(lastUserMsg.content);
    }
  }, [session.messages, session.submit]);

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

      {isDone && session.lastOutput && (
        <ActionBar
          onApply={handleApply}
          onRegenerate={handleRegenerate}
          content={session.lastOutput}
        />
      )}

      <InputBar
        onSubmit={session.submit}
        onCancel={session.cancel}
        isStreaming={isStreaming}
      />
    </div>
  );
}
