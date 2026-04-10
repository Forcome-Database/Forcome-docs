import React, { useState, useEffect } from "react";
import { TextInput, MantineSpacing } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { IconSearch } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

export interface SearchInputProps {
  placeholder?: string;
  debounceDelay?: number;
  onSearch: (value: string) => void;
  mb?: MantineSpacing;
}

export function SearchInput({
  placeholder,
  debounceDelay = 500,
  onSearch,
  mb = "sm",
}: SearchInputProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const [debouncedValue] = useDebouncedValue(value, debounceDelay);

  useEffect(() => {
    onSearch(debouncedValue);
  }, [debouncedValue, onSearch]);

  return (
    <TextInput
      size="sm"
      placeholder={placeholder || t("Search...")}
      leftSection={<IconSearch size={16} />}
      value={value}
      onChange={(e) => setValue(e.currentTarget.value)}
      mb={mb}
    />
  );
}
