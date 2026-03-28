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

  // Capture selection on input bar focus — catches both REPLACE (non-empty) and INSERT (cursor)
  // This fires BEFORE the editor loses focus, ensuring we get the live selection state.
  const captureSelectionOnFocus = useCallback(() => {
    if (!editor) return;
    const sel = editor.state.selection;
    if (!sel.empty) {
      setCurrentSelection(captureEditorSelection(editor)); // REPLACE mode
    } else if (sel.from > 1) {
      // Cursor placement → INSERT mode (captureEditorSelection handles this)
      setCurrentSelection(captureEditorSelection(editor));
    }
    // else: no meaningful selection → stays null (FULL mode)
  }, [editor]);

  const closePanel = () => setAside({ tab: "", isAsideOpen: false });

  const lastSnapshotRef = useRef<any>(null);

  const handleApply = useCallback(async () => {
    if (!session.lastOutput || !editor) return;

    const markdown = titleEditor
      ? maybeExtractTitle(titleEditor, session.lastOutput)
      : session.lastOutput;

    // Read edit mode from the done event
    const applyMode: "full" | "replace" | "insert" = session.editMode || "full";
    let from: number | undefined;
    let to: number | undefined;

    // For selection modes: use the SUBMITTED selection snapshot (immutable),
    // not the live currentSelection (which may have changed since submit).
    if (applyMode !== "full") {
      const lastUserMsg = [...session.messages].reverse().find((m) => m.role === "user");
      const snapshot = lastUserMsg?.selectionSnapshot;

      if (!snapshot || snapshot.from == null) {
        notifications.show({
          message: t("No selection data available. Please select text and try again."),
          color: "red",
        });
        return;
      }

      if (applyMode === "insert") {
        // INSERT mode: lenient verification — only check position is in valid range.
        // Insert doesn't replace anything, so wrong position = content at wrong spot,
        // not data loss. Much safer than REPLACE mode.
        const docSize = editor.state.doc.content.size;
        from = Math.min(snapshot.from, docSize);
        to = from; // insert = from === to
      } else {
        // REPLACE mode: strict verification with text anchors (fail-closed).
        const relocated = verifyAndRelocate(editor, {
          mode: snapshot.mode,
          from: snapshot.from,
          to: snapshot.to,
          selectedText: snapshot.selectedText,
          anchorBefore: snapshot.anchorBefore,
          anchorAfter: snapshot.anchorAfter,
          contextBefore: "",
          contextAfter: "",
          documentOutline: "",
        });

        if (!relocated) {
          notifications.show({
            message: t("Cannot locate the original selection. Please select the text again and retry."),
            color: "red",
          });
          return;
        }

        from = relocated.from;
        to = relocated.to;
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
  }, [session.lastOutput, session.editMode, session.messages, editor, titleEditor, t]);

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
        // Selection mode: send selection context + full selection data (for immutable snapshot)
        session.submit(prompt, files, undefined, {
          editMode: selection.mode,
          selectedText: selection.selectedText || undefined,
          contextBefore: selection.contextBefore || undefined,
          contextAfter: selection.contextAfter || undefined,
          documentOutline: selection.documentOutline || undefined,
          // Pass position data for immutable snapshot storage in message
          from: selection.from,
          to: selection.to,
          anchorBefore: selection.anchorBefore,
          anchorAfter: selection.anchorAfter,
        } as any);
        // Clear live selection after submit — the snapshot is now in the message
        setCurrentSelection(null);
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
    if (!lastUserMsg) return;

    // Reuse the stored selection snapshot from the original message
    const snapshot = lastUserMsg.selectionSnapshot;
    if (snapshot && snapshot.mode !== "full") {
      session.submit(lastUserMsg.content, undefined, undefined, {
        editMode: snapshot.mode,
        selectedText: snapshot.selectedText || undefined,
        contextBefore: "",
        contextAfter: "",
        documentOutline: "",
        from: snapshot.from,
        to: snapshot.to,
        anchorBefore: snapshot.anchorBefore,
        anchorAfter: snapshot.anchorAfter,
      } as any);
    } else {
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
        onFocus={captureSelectionOnFocus}
      />
    </div>
  );
}
