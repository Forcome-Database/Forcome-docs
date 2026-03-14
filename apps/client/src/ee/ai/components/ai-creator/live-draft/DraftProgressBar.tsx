import { Progress, Text, Stack, Group, Badge } from '@mantine/core';

interface DraftProgressBarProps {
  current: number;
  total: number;
  sectionTitle?: string;
  status?: 'writing' | 'done' | 'error';
}

export function DraftProgressBar({ current, total, sectionTitle, status = 'writing' }: DraftProgressBarProps) {
  const percent = total > 0 ? (current / total) * 100 : 0;
  const color = status === 'error' ? 'red' : status === 'done' ? 'green' : 'blue';

  return (
    <Stack gap={4}>
      <Group justify="space-between">
        <Text size="xs" c="dimmed">
          {status === 'done'
            ? `✅ 全部 ${total} 章写作完成`
            : `正在写作第 ${current}/${total} 章`}
        </Text>
        <Badge size="xs" variant="light" color={color}>
          {Math.round(percent)}%
        </Badge>
      </Group>
      {sectionTitle && status === 'writing' && (
        <Text size="xs" fw={500} lineClamp={1}>{sectionTitle}</Text>
      )}
      <Progress value={percent} size="sm" color={color} animated={status === 'writing'} />
    </Stack>
  );
}
