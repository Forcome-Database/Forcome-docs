import React from 'react';
import { Paper, Text, Stack, List } from '@mantine/core';
import type { ReviewIssue } from '../../../types/review.types';

interface AutoFixSummaryProps {
  issues: ReviewIssue[];
}

export function AutoFixSummary({ issues }: AutoFixSummaryProps) {
  const fixed = issues.filter(i => i.auto_fixable && i.fixed);
  if (fixed.length === 0) return null;

  return (
    <Paper p="xs" radius="sm" bg="green.0">
      <Text size="xs" fw={600} c="green.8" mb={4}>✅ 已自动修复（{fixed.length} 项）</Text>
      <List size="xs" spacing={2}>
        {fixed.map(issue => (
          <List.Item key={issue.id}>
            <Text size="xs" c="dimmed">{issue.description}</Text>
          </List.Item>
        ))}
      </List>
    </Paper>
  );
}
