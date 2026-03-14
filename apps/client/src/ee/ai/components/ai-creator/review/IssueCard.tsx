import { Checkbox, Paper, Group, Badge, Text, Stack } from '@mantine/core';
import type { ReviewIssue } from '../../../types/review.types';

interface IssueCardProps {
  issue: ReviewIssue;
  selected: boolean;
  onToggle: (issueId: string) => void;
  disabled?: boolean;
}

const severityColors: Record<string, string> = {
  error: 'red',
  warning: 'yellow',
  info: 'blue',
};

const categoryLabels: Record<string, string> = {
  length: '篇幅',
  structure: '结构',
  content: '内容',
  style: '风格',
  asset: '素材',
  visual: '配图',
  format: '格式',
};

export function IssueCard({ issue, selected, onToggle, disabled }: IssueCardProps) {
  return (
    <Paper withBorder p="xs" radius="sm" opacity={issue.fixed ? 0.5 : 1}>
      <Group gap="sm" wrap="nowrap" align="flex-start">
        <Checkbox
          size="xs"
          checked={selected}
          onChange={() => onToggle(issue.id)}
          disabled={disabled || issue.fixed || issue.auto_fixable}
          mt={2}
        />
        <Stack gap={4} flex={1}>
          <Group gap="xs">
            <Badge size="xs" color={severityColors[issue.severity] || 'gray'}>
              {issue.severity}
            </Badge>
            <Badge size="xs" variant="outline">
              {categoryLabels[issue.category] || issue.category}
            </Badge>
            {issue.fixed && <Badge size="xs" color="green">已修复</Badge>}
          </Group>
          <Text size="xs">{issue.description}</Text>
          {issue.suggestion && (
            <Text size="xs" c="dimmed" fs="italic">建议：{issue.suggestion}</Text>
          )}
        </Stack>
      </Group>
    </Paper>
  );
}
