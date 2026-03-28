import { useCallback, useEffect, useRef, useState } from "react";
import { ActionIcon, Group, Text, Tooltip } from "@mantine/core";
import { IconCursorText, IconPlus, IconSparkles, IconX } from "@tabler/icons-react";
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
import {
  captureEditorSelection,
  verifyAndRelocate,
  type EditorSelection,
} from "../../utils/editor-selection";

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

  const [currentSelection, setCurrentSelection] = useState<EditorSelection | null>(null);

  // Track editor selection continuously via TipTap's onSelectionUpdate
  useEffect(() => {
    if (!editor) return;
    const handler = () => {
      const sel = editor.state.selection;
      if (!sel.empty) {
        setCurrentSelection(captureEditorSelection(editor));
      }
    };
    editor.on("selectionUpdate", handler);
    return () => { editor.off("selectionUpdate", handler); };
  }, [editor]);

  const closePanel = () => setAside({ tab: "", isAsideOpen: false });

  const lastSnapshotRef = useRef<any>(null);

  const handleApply = useCallback(async () => {
    if (!session.lastOutput || !editor) return;

    const markdown = titleEditor
      ? maybeExtractTitle(titleEditor, session.lastOutput)
      : session.lastOutput;

    let applyMode: "full" | "replace" | "insert" = session.editMode || "full";
    let from: number | undefined;
    let to: number | undefined;

    // For selection modes, verify positions are still valid
    if (applyMode !== "full" && currentSelection) {
      const relocated = verifyAndRelocate(editor, currentSelection);
      if (relocated) {
        from = relocated.from;
        to = relocated.to;
      } else {
        // Position verification failed — fallback to full mode
        notifications.show({
          message: t("Document changed since selection. Applying as full document."),
          color: "yellow",
        });
        applyMode = "full";
      }
    }

    const result = await safeApply({
      editor,
      titleEditor,
      markdown,
      mode: applyMode,
      from,
      to,
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
  }, [session.lastOutput, session.editMode, currentSelection, editor, titleEditor, t]);

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
      const selection = currentSelection;

      if (selection && selection.mode !== "full") {
        // Selection mode: send selection context instead of full page content
        session.submit(prompt, files, undefined, {
          editMode: selection.mode,
          selectedText: selection.selectedText || undefined,
          contextBefore: selection.contextBefore || undefined,
          contextAfter: selection.contextAfter || undefined,
          documentOutline: selection.documentOutline || undefined,
        });
      } else {
        // Full mode: send page content (existing behavior for follow-ups)
        const pageContent = session.threadId ? getPageContent() : undefined;
        session.submit(prompt, files, pageContent);
      }
    },
    [currentSelection, session.threadId, session.submit, getPageContent],
  );

  const handleRegenerate = useCallback(() => {
    const lastUserMsg = [...session.messages]
      .reverse()
      .find((m) => m.role === "user");
    if (lastUserMsg) {
      if (currentSelection && currentSelection.mode !== "full") {
        session.submit(lastUserMsg.content, undefined, undefined, {
          editMode: currentSelection.mode,
          selectedText: currentSelection.selectedText || undefined,
          contextBefore: currentSelection.contextBefore || undefined,
          contextAfter: currentSelection.contextAfter || undefined,
          documentOutline: currentSelection.documentOutline || undefined,
        });
      } else {
        const pageContent = getPageContent();
        session.submit(lastUserMsg.content, undefined, pageContent);
      }
    }
  }, [session.messages, session.submit, currentSelection, getPageContent]);

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

      {currentSelection && currentSelection.mode !== "full" && (
        <Group gap={6} px="sm" py={4}
          style={{ borderTop: "1px solid light-dark(var(--mantine-color-gray-2), var(--mantine-color-dark-5))" }}
        >
          <IconCursorText size={14} style={{ color: "#6366f1" }} />
          <Text size="xs" c="dimmed">
            {currentSelection.mode === "replace"
              ? t("Editing selected content")
              : t("Inserting at cursor")}
          </Text>
          <ActionIcon size="xs" variant="subtle" onClick={() => setCurrentSelection(null)}>
            <IconX size={10} />
          </ActionIcon>
        </Group>
      )}

      <InputBar
        onSubmit={handleSubmit}
        onCancel={session.cancel}
        isStreaming={isStreaming}
      />
    </div>
  );
}
