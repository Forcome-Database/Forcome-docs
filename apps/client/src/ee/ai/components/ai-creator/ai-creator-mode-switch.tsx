import { SegmentedControl } from "@mantine/core";
import { useAtom } from "jotai";
import {
  aiCreatorModeAtom,
  aiCreatorModeLockAtom,
} from "./ai-creator-atoms";
import { useTranslation } from "react-i18next";
import { AiCreatorMode } from "./ai-creator.types";
import classes from "./ai-creator.module.css";

export function AiCreatorModeSwitch() {
  const { t } = useTranslation();
  const [mode, setMode] = useAtom(aiCreatorModeAtom);
  const [, setModeLock] = useAtom(aiCreatorModeLockAtom);

  const handleChange = (value: string) => {
    setMode(value as AiCreatorMode);
    setModeLock(true);
  };

  return (
    <div className={classes.modeSwitch}>
      <SegmentedControl
        size="xs"
        fullWidth
        value={mode}
        onChange={handleChange}
        data={[
          { label: t("Edit"), value: "edit" },
          { label: t("Chat"), value: "chat" },
        ]}
      />
    </div>
  );
}
