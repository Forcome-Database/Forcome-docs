import { Progress, Text, Stack } from '@mantine/core';

interface DraftProgressBarProps {
  current: number;
  total: number;
  sectionTitle?: string;
}

export function DraftProgressBar({ current, total, sectionTitle }: DraftProgressBarProps) {
  const percent = total > 0 ? (current / total) * 100 : 0;
  return (
    <Stack gap="xs">
      <Text size="xs" c="dimmed">
        {sectionTitle ? `正在写作第 ${current}/${total} 章：${sectionTitle}` : `${current}/${total}`}
      </Text>
      <Progress value={percent} size="sm" />
    </Stack>
  );
}
