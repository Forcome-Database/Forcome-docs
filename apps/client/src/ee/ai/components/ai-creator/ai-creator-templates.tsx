import { Select } from "@mantine/core";
import { useAtom } from "jotai";
import { aiCreatorTemplateAtom } from "./ai-creator-atoms";
import { AI_TEMPLATE_OPTIONS } from "./ai-creator.types";
import { useTranslation } from "react-i18next";

export function AiCreatorTemplates() {
  const { t } = useTranslation();
  const [template, setTemplate] = useAtom(aiCreatorTemplateAtom);

  return (
    <Select
      size="xs"
      placeholder={t("Template (optional)")}
      value={template}
      onChange={setTemplate}
      clearable
      mb="xs"
      data={AI_TEMPLATE_OPTIONS.map((tmpl) => ({
        value: tmpl.key,
        label: t(tmpl.name),
      }))}
    />
  );
}
