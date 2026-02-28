import { Select } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { useGetTopicsQuery } from "../queries/topic-query";

interface TopicSelectProps {
  directoryId: string | null;
  value?: string | null;
  onChange: (topicId: string | null) => void;
}

export function TopicSelect({
  directoryId,
  value,
  onChange,
}: TopicSelectProps) {
  const { t } = useTranslation();
  const { data } = useGetTopicsQuery(directoryId || "");

  const options = (data?.items || []).map((topic) => ({
    value: topic.id,
    label: topic.name,
  }));

  return (
    <Select
      label={t("Topic")}
      placeholder={t("Select topic")}
      data={options}
      value={value}
      onChange={onChange}
      clearable
      disabled={!directoryId}
    />
  );
}
