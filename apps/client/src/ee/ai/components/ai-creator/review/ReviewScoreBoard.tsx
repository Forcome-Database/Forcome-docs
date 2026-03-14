import { Group, RingProgress, Text, Stack, Paper, SimpleGrid } from '@mantine/core';

interface ReviewScoreBoardProps {
  overallScore: number;
  lengthCompliance: number;
  assetReuseRate: number;
  issueCount: number;
  autoFixedCount: number;
}

export function ReviewScoreBoard({ overallScore, lengthCompliance, assetReuseRate, issueCount, autoFixedCount }: ReviewScoreBoardProps) {
  const scoreColor = overallScore >= 80 ? 'green' : overallScore >= 60 ? 'yellow' : 'red';

  return (
    <Paper withBorder p="md" radius="md">
      <Group align="flex-start" gap="lg">
        <RingProgress
          size={80}
          thickness={8}
          roundCaps
          sections={[{ value: overallScore, color: scoreColor }]}
          label={<Text ta="center" fw={700} size="lg">{overallScore}</Text>}
        />
        <SimpleGrid cols={2} spacing="xs" flex={1}>
          <Stack gap={2}>
            <Text size="xs" c="dimmed">篇幅达标率</Text>
            <Text size="sm" fw={500}>{(lengthCompliance * 100).toFixed(0)}% {lengthCompliance >= 0.9 ? '✅' : '⚠️'}</Text>
          </Stack>
          <Stack gap={2}>
            <Text size="xs" c="dimmed">素材复用率</Text>
            <Text size="sm" fw={500}>{(assetReuseRate * 100).toFixed(0)}% {assetReuseRate >= 0.8 ? '✅' : '⚠️'}</Text>
          </Stack>
          <Stack gap={2}>
            <Text size="xs" c="dimmed">发现问题</Text>
            <Text size="sm" fw={500}>{issueCount} 项</Text>
          </Stack>
          <Stack gap={2}>
            <Text size="xs" c="dimmed">已自动修复</Text>
            <Text size="sm" fw={500} c="green">{autoFixedCount} 项</Text>
          </Stack>
        </SimpleGrid>
      </Group>
    </Paper>
  );
}
