import { Group, Text, SegmentedControl } from "@mantine/core";
import { useAtom } from "jotai";
import { workspaceAtom } from "@/features/user/atoms/current-user-atom.ts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { updateWorkspace } from "@/features/workspace/services/workspace-service.ts";
import { notifications } from "@mantine/notifications";
import useUserRole from "@/hooks/use-user-role.tsx";

export default function WikiRenderFormatPref() {
  const { t } = useTranslation();
  const [workspace, setWorkspace] = useAtom(workspaceAtom);
  const { isAdmin } = useUserRole();
  const [value, setValue] = useState(
    workspace?.settings?.wiki?.renderFormat || "html",
  );

  const handleChange = async (newValue: string) => {
    const oldValue = value;
    setValue(newValue);
    try {
      const updatedWorkspace = await updateWorkspace({
        wikiRenderFormat: newValue,
      });
      setWorkspace(updatedWorkspace);
    } catch (err: any) {
      setValue(oldValue);
      notifications.show({
        message: err?.response?.data?.message || t("Failed to update data"),
        color: "red",
      });
    }
  };

  return (
    <Group justify="space-between" wrap="nowrap" gap="xl">
      <div>
        <Text size="md">{t("Wiki render format")}</Text>
        <Text size="sm" c="dimmed">
          {t(
            "Choose how wiki pages are rendered for visitors. HTML preserves the original editor layout, Markdown provides cleaner text rendering.",
          )}
        </Text>
      </div>

      <SegmentedControl
        value={value}
        onChange={handleChange}
        disabled={!isAdmin}
        data={[
          { label: "HTML", value: "html" },
          { label: "Markdown", value: "markdown" },
        ]}
      />
    </Group>
  );
}
