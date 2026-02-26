import { useEffect } from "react";
import {
  ActionIcon,
  Group,
  ScrollArea,
  SegmentedControl,
  Text,
} from "@mantine/core";
import { IconSparkles, IconX } from "@tabler/icons-react";
import { useAtom, useAtomValue } from "jotai";
import { pageEditorAtom, titleEditorAtom } from "@/features/editor/atoms/editor-atoms";
import { asideStateAtom } from "@/components/layouts/global/hooks/atoms/sidebar-atom";
import {
  aiCreatorModeAtom,
  aiCreatorModeLockAtom,
  aiCreatorSelectionAtom,
  aiCreatorSelectionRangeAtom,
  aiCreatorInsertModeAtom,
  SelectionRange,
} from "./ai-creator-atoms";
import { AiCreatorModeSwitch } from "./ai-creator-mode-switch";
import { AiCreatorSelection } from "./ai-creator-selection";
import { AiCreatorMessages } from "./ai-creator-messages";
import { AiCreatorInput } from "./ai-creator-input";
import { InsertMode } from "./ai-creator.types";
import { useTranslation } from "react-i18next";
import classes from "./ai-creator.module.css";

export default function AiCreatorPanel() {
  const { t } = useTranslation();
  const editor = useAtomValue(pageEditorAtom);
  const titleEditor = useAtomValue(titleEditorAtom);
  const [mode, setMode] = useAtom(aiCreatorModeAtom);
  const [modeLock, setModeLock] = useAtom(aiCreatorModeLockAtom);
  const [, setSelection] = useAtom(aiCreatorSelectionAtom);
  const [, _setSelectionRange] = useAtom(aiCreatorSelectionRangeAtom);
  const setSelectionRange = _setSelectionRange as (v: SelectionRange | null) => void;
  const [, setAsideState] = useAtom(asideStateAtom);
  const [insertMode, setInsertMode] = useAtom(aiCreatorInsertModeAtom);

  const pageHasContent = editor && editor.state.doc.textContent.trim().length > 0;

  useEffect(() => {
    if (!editor) return;

    const onSelectionUpdate = () => {
      const { from, to, empty } = editor.state.selection;
      if (empty) {
        setSelection("");
        setSelectionRange(null);
        if (!modeLock) setMode("create");
        setModeLock(false);
      } else {
        const text = editor.state.doc.textBetween(from, to, "\n");
        setSelection(text);
        setSelectionRange({ from, to });
        if (!modeLock) setMode("edit");
      }
    };

    editor.on("selectionUpdate", onSelectionUpdate);
    onSelectionUpdate();

    return () => {
      editor.off("selectionUpdate", onSelectionUpdate);
    };
  }, [editor, modeLock]);

  const hasSelection = useAtomValue(aiCreatorSelectionAtom).length > 0;

  const handleClose = () => {
    setAsideState({ tab: "", isAsideOpen: false });
  };

  return (
    <div className={classes.panelRoot}>
      {/* Header */}
      <div className={classes.panelHeader}>
        <Group gap="xs">
          <div className={classes.sparkleIcon}>
            <IconSparkles size={14} />
          </div>
          <Text fw={600} size="sm">
            AI {t("Creator")}
          </Text>
        </Group>
        <ActionIcon variant="subtle" color="gray" size="sm" onClick={handleClose}>
          <IconX size={16} />
        </ActionIcon>
      </div>

      {/* Context hint - at TOP, only in create mode when page has content */}
      {mode === "create" && pageHasContent && (
        <div className={classes.contextHint}>
          <Text size="xs" c="dimmed" mb={4}>
            {t("Page has existing content")}
          </Text>
          <SegmentedControl
            size="xs"
            fullWidth
            value={insertMode}
            onChange={(v) => setInsertMode(v as InsertMode)}
            data={[
              { label: t("Append"), value: "append" },
              { label: t("Overwrite"), value: "overwrite" },
            ]}
          />
        </div>
      )}

      {/* Mode switch - only when there's a selection */}
      {hasSelection && <AiCreatorModeSwitch />}

      {/* Selection preview - edit/chat modes */}
      {hasSelection && (mode === "edit" || mode === "chat") && (
        <AiCreatorSelection />
      )}

      {/* Messages area */}
      <ScrollArea className={classes.scrollArea} scrollbarSize={5} type="scroll">
        <AiCreatorMessages />
      </ScrollArea>

      {/* Input area */}
      <AiCreatorInput />
    </div>
  );
}
