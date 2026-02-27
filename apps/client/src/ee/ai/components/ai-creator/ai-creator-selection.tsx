import { ActionIcon, Group, Text } from "@mantine/core";
import { IconX } from "@tabler/icons-react";
import { useAtom } from "jotai";
import { aiCreatorSelectionAtom, aiCreatorSelectionRangeAtom, SelectionRange } from "./ai-creator-atoms";
import { useTranslation } from "react-i18next";
import classes from "./ai-creator.module.css";

export function AiCreatorSelection() {
  const { t } = useTranslation();
  const [selection, setSelection] = useAtom(aiCreatorSelectionAtom);
  const [, _setSelectionRange] = useAtom(aiCreatorSelectionRangeAtom);
  const setSelectionRange = _setSelectionRange as (v: SelectionRange | null) => void;

  if (!selection) return null;

  const handleClear = () => {
    setSelection("");
    setSelectionRange(null);
  };

  return (
    <div className={classes.selectionPreview}>
      <Group justify="space-between" mb={2}>
        <Text size="xs" c="dimmed">
          {t("Selected text")}
        </Text>
        <ActionIcon variant="subtle" color="gray" size="xs" onClick={handleClear}>
          <IconX size={12} />
        </ActionIcon>
      </Group>
      <Text size="sm" lineClamp={3} style={{ whiteSpace: "pre-wrap" }}>
        {selection}
      </Text>
    </div>
  );
}
