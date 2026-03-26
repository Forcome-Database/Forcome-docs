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
    <Group gap="xs" className={classes.actionBar}>
      <Button
        size="xs"
        leftSection={<IconArrowBarDown size={14} />}
        onClick={onApply}
        disabled={disabled}
      >
        {t("Apply to page")}
      </Button>
      <Button
        size="xs"
        variant="default"
        leftSection={<IconRefresh size={14} />}
        onClick={onRegenerate}
        disabled={disabled}
      >
        {t("Regenerate")}
      </Button>
      <Button
        size="xs"
        variant="default"
        leftSection={<IconCopy size={14} />}
        onClick={handleCopy}
      >
        {t("Copy")}
      </Button>
    </Group>
  );
}
