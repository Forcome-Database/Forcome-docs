import { useEffect } from "react";
import {
  ActionIcon,
  Group,
  ScrollArea,
  Text,
  Tooltip,
} from "@mantine/core";
import { IconX, IconPlus } from "@tabler/icons-react";
import { useAtom, useAtomValue } from "jotai";
import { NodeSelection } from "@tiptap/pm/state";
import { pageEditorAtom } from "@/features/editor/atoms/editor-atoms";
import { asideStateAtom } from "@/components/layouts/global/hooks/atoms/sidebar-atom";
import {
  aiCreatorSelectionAtom,
  aiCreatorSelectionRangeAtom,
  aiCreatorMessagesAtom,
  SelectionRange,
} from "./ai-creator-atoms";
import { AiCreatorSelection } from "./ai-creator-selection";
import { AiCreatorMessages } from "./ai-creator-messages";
import { AiCreatorInput } from "./ai-creator-input";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { extractPageSlugId } from "@/lib";
import classes from "./ai-creator.module.css";

export default function AiCreatorPanel() {
  const { t } = useTranslation();
  const editor = useAtomValue(pageEditorAtom);
  const [, setSelection] = useAtom(aiCreatorSelectionAtom);
  const [, _setSelectionRange] = useAtom(aiCreatorSelectionRangeAtom);
  const setSelectionRange = _setSelectionRange as (v: SelectionRange | null) => void;
  const [, setAsideState] = useAtom(asideStateAtom);
  const [, setAllMessages] = useAtom(aiCreatorMessagesAtom);
  const { pageSlug } = useParams();
  const pageId = extractPageSlugId(pageSlug);

  const hasSelection = useAtomValue(aiCreatorSelectionAtom).length > 0;

  // Clear messages when panel mounts (each open starts fresh)
  useEffect(() => {
    setAllMessages((prev) => ({ ...prev, [pageId]: [] }));
  }, []);

  // Listen to editor selection updates (as context only, no mode switching)
  useEffect(() => {
    if (!editor) return;

    const onSelectionUpdate = () => {
      const { selection } = editor.state;
      const { from, to, empty } = selection;
      if (empty) {
        setSelection("");
        setSelectionRange(null);
      } else if (selection instanceof NodeSelection) {
        // NodeSelection (e.g. clicking a code block node) — extract node text
        const node = selection.node;
        setSelection(node.textContent || "");
        setSelectionRange({ from, to });
      } else {
        const text = editor.state.doc.textBetween(from, to, "\n");
        setSelection(text);
        setSelectionRange({ from, to });
      }
    };

    editor.on("selectionUpdate", onSelectionUpdate);
    onSelectionUpdate();

    return () => {
      editor.off("selectionUpdate", onSelectionUpdate);
    };
  }, [editor]);

  const handleClose = () => {
    setAsideState({ tab: "", isAsideOpen: false });
  };

  const handleNewChat = () => {
    setAllMessages((prev) => ({ ...prev, [pageId]: [] }));
  };

  return (
    <div className={classes.panelRoot}>
      {/* Header */}
      <div className={classes.panelHeader}>
        <Group gap="xs">
          <img src="/icons/app-icon-192x192.png" alt="" width={24} height={24} style={{ borderRadius: 6 }} />
          <Text fw={600} size="sm">
            {t("AI Assistant")}
          </Text>
        </Group>
        <Group gap={4}>
          <Tooltip label={t("New conversation")} openDelay={300}>
            <ActionIcon variant="subtle" color="gray" size="sm" onClick={handleNewChat}>
              <IconPlus size={16} />
            </ActionIcon>
          </Tooltip>
          <ActionIcon variant="subtle" color="gray" size="sm" onClick={handleClose}>
            <IconX size={16} />
          </ActionIcon>
        </Group>
      </div>

      {/* Messages area */}
      <ScrollArea className={classes.scrollArea} scrollbarSize={5} type="scroll">
        <AiCreatorMessages />
      </ScrollArea>

      {/* Selection context (shown above input when there's a selection) */}
      {hasSelection && <AiCreatorSelection />}

      {/* Input area */}
      <AiCreatorInput />
    </div>
  );
}
