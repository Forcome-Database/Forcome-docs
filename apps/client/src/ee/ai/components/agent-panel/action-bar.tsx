import { Button, Group } from "@mantine/core";
import { IconArrowBarDown, IconCopy, IconRefresh } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { notifications } from "@mantine/notifications";
import classes from "./agent-panel.module.css";

interface ActionBarProps {
  onApply: () => void;
  onRegenerate: () => void;
  content: string;
  disabled?: boolean;
}

export function ActionBar({ onApply, onRegenerate, content, disabled }: ActionBarProps) {
  const { t } = useTranslation();

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    notifications.show({ message: t("Copied"), color: "green" });
  };

  return (
    <Group gap={6} className={classes.actionBar}>
      <Button
        size="xs"
        className={classes.applyButton}
        leftSection={<IconArrowBarDown size={14} />}
        onClick={onApply}
        disabled={disabled}
      >
        {t("Apply to page")}
      </Button>
      <div style={{ width: 4 }} />
      <Button
        size="xs"
        variant="default"
        className={classes.secondaryButton}
        leftSection={<IconRefresh size={14} />}
        onClick={onRegenerate}
        disabled={disabled}
      >
        {t("Regenerate")}
      </Button>
      <Button
        size="xs"
        variant="default"
        className={classes.secondaryButton}
        leftSection={<IconCopy size={14} />}
        onClick={handleCopy}
      >
        {t("Copy")}
      </Button>
    </Group>
  );
}
