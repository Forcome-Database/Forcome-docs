import React from "react";
import { Badge, Button, Group, Paper, Stack, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";

interface ExpertCollabOption {
  id?: string;
  label?: string;
}

interface ExpertCollabPanelProps {
  reason: string | null;
  question: string | null;
  options: ExpertCollabOption[];
  recommendedOption: string | null;
  onConfirm?: () => void;
  onRevise?: () => void;
}

function normalizeOptionId(option: ExpertCollabOption): string {
  return String(option.id || option.label || "").trim().toLowerCase();
}

function resolveActionLabel(
  option: ExpertCollabOption,
  fallback: string,
  t: (key: string) => string,
): string {
  const resolvedFallback = t(fallback);
  const label = String(option.label || resolvedFallback).trim();
  return label || resolvedFallback;
}

export function ExpertCollabPanel({
  reason,
  question,
  options,
  recommendedOption,
  onConfirm,
  onRevise,
}: ExpertCollabPanelProps) {
  const { t } = useTranslation();
  if (!question && options.length === 0) {
    return null;
  }

  return (
    <Paper withBorder radius="lg" p="sm">
      <Stack gap="sm">
        <Group justify="space-between">
          <Text fw={600} size="sm">
            {t("Expert Collaboration")}
          </Text>
          {reason ? (
            <Badge variant="light" color="blue">
              {reason}
            </Badge>
          ) : null}
        </Group>
        {question ? <Text size="sm">{question}</Text> : null}
        {options.length > 0 ? (
          <Group gap="xs">
            {options.map((option, index) => {
              const label = option.label || option.id || `option-${index + 1}`;
              const optionId = normalizeOptionId(option);
              const highlighted =
                recommendedOption !== null &&
                (option.id === recommendedOption || label === recommendedOption);
              if (optionId === "confirm") {
                return (
                  <Button
                    key={option.id || `${label}-${index}`}
                    size="xs"
                    variant={highlighted ? "filled" : "default"}
                    onClick={onConfirm}
                    disabled={!onConfirm}
                  >
                    {resolveActionLabel(option, "Confirm", t)}
                  </Button>
                );
              }
              if (optionId === "revise") {
                return (
                  <Button
                    key={option.id || `${label}-${index}`}
                    size="xs"
                    variant={highlighted ? "filled" : "default"}
                    onClick={onRevise}
                    disabled={!onRevise}
                  >
                    {resolveActionLabel(option, "Revise", t)}
                  </Button>
                );
              }
              return (
                <Badge
                  key={option.id || `${label}-${index}`}
                  variant={highlighted ? "filled" : "light"}
                  color={highlighted ? "green" : "gray"}
                >
                  {label}
                </Badge>
              );
            })}
          </Group>
        ) : null}
      </Stack>
    </Paper>
  );
}
