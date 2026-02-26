import { Text } from "@mantine/core";
import { useAtomValue } from "jotai";
import { aiCreatorSelectionAtom } from "./ai-creator-atoms";
import { useTranslation } from "react-i18next";
import classes from "./ai-creator.module.css";

export function AiCreatorSelection() {
  const { t } = useTranslation();
  const selection = useAtomValue(aiCreatorSelectionAtom);

  if (!selection) return null;

  return (
    <div className={classes.selectionPreview}>
      <Text size="xs" c="dimmed" mb={2}>
        {t("Selected text")}
      </Text>
      <Text size="sm" lineClamp={3} style={{ whiteSpace: "pre-wrap" }}>
        {selection}
      </Text>
    </div>
  );
}
