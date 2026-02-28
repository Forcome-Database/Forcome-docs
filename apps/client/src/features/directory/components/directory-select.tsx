import { Select } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { useGetDirectoriesQuery } from "../queries/directory-query";

interface DirectorySelectProps {
  spaceId: string;
  value?: string | null;
  onChange: (directoryId: string | null) => void;
}

export function DirectorySelect({
  spaceId,
  value,
  onChange,
}: DirectorySelectProps) {
  const { t } = useTranslation();
  const { data } = useGetDirectoriesQuery(spaceId);

  const options = (data?.items || []).map((dir) => ({
    value: dir.id,
    label: dir.name,
  }));

  return (
    <Select
      label={t("Directory")}
      placeholder={t("Select directory")}
      data={options}
      value={value}
      onChange={onChange}
      clearable
    />
  );
}
