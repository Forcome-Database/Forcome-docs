import { Modal, Stack, Group, Button, Textarea, Divider, Text, ScrollArea } from '@mantine/core';
import { useState } from 'react';
import type { ReviewReport } from '../../../types/review.types';
import { ReviewScoreBoard } from './ReviewScoreBoard';
import { IssueCard } from './IssueCard';
import { AutoFixSummary } from './AutoFixSummary';
import { useReviewActions } from '../../../hooks/use-review-actions';

interface ReviewModalProps {
  opened: boolean;
  onClose: () => void;
  report: ReviewReport;
  onFixSelected: (issueIds: string[], feedback?: string) => void;
  onSkip: () => void;
}

export function ReviewModal({ opened, onClose, report, onFixSelected, onSkip }: ReviewModalProps) {
  const { selectedIssueIds, toggleIssue, selectAll, clearSelection, pendingIssues, autoFixedIssues, selectedCount } = useReviewActions(report);
  const [feedback, setFeedback] = useState('');

  const handleFix = () => {
    onFixSelected(Array.from(selectedIssueIds), feedback || undefined);
    onClose();
  };

  return (
    <Modal opened={opened} onClose={onClose} size="xl" title="📋 质量评审报告">
      <Stack gap="md">
        <ReviewScoreBoard
          overallScore={report.overall_score}
          lengthCompliance={report.length_compliance}
          assetReuseRate={report.asset_reuse_rate}
          issueCount={report.issues.length}
          autoFixedCount={report.auto_fixed_count}
        />

        <AutoFixSummary issues={report.issues} />

        {pendingIssues.length > 0 && (
          <>
            <Divider />
            <Group justify="space-between">
              <Text size="sm" fw={600}>⚠️ 需要您决定（{pendingIssues.length} 项）</Text>
              <Group gap="xs">
                <Button size="compact-xs" variant="subtle" onClick={selectAll}>全选</Button>
                <Button size="compact-xs" variant="subtle" onClick={clearSelection}>清除</Button>
              </Group>
            </Group>
            <ScrollArea mah={300}>
              <Stack gap="xs">
                {pendingIssues.map(issue => (
                  <IssueCard
                    key={issue.id}
                    issue={issue}
                    selected={selectedIssueIds.has(issue.id)}
                    onToggle={toggleIssue}
                  />
                ))}
              </Stack>
            </ScrollArea>
          </>
        )}

        <Textarea
          placeholder="补充修改意见（可选）"
          size="xs"
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          autosize
          minRows={2}
          maxRows={4}
        />

        <Divider />
        <Group justify="flex-end">
          <Button size="sm" variant="subtle" onClick={() => { onSkip(); onClose(); }}>
            跳过，直接使用
          </Button>
          <Button size="sm" onClick={handleFix} disabled={selectedCount === 0}>
            修复选中项（{selectedCount}）
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
