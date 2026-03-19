import React, { useState } from 'react';
import { Modal, Stack, Group, Button, Textarea, Divider, Text, ScrollArea } from '@mantine/core';
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
  onContinue: (feedback?: string) => void;
  onSkip: () => void;
  withinPortal?: boolean;
}

function isBlockingReviewIssue(issue: ReviewReport['issues'][number]): boolean {
  return issue.severity === 'error' && !issue.fixed && !issue.auto_fixable;
}

export function ReviewModal({
  opened,
  onClose,
  report,
  onFixSelected,
  onContinue,
  onSkip,
  withinPortal,
}: ReviewModalProps) {
  const { selectedIssueIds, toggleIssue, selectAll, clearSelection, pendingIssues, selectedCount } = useReviewActions(report);
  const [feedback, setFeedback] = useState('');
  const skippableIssueCount = pendingIssues.filter((issue) => issue.category === 'visual').length;
  const blockingIssueCount = pendingIssues.filter(isBlockingReviewIssue).length;

  const handleFix = () => {
    onFixSelected(Array.from(selectedIssueIds), feedback || undefined);
    onClose();
  };

  const handleContinue = () => {
    onContinue(feedback || undefined);
    onClose();
  };

  return (
    <Modal opened={opened} onClose={onClose} size="xl" title="Quality Review" withinPortal={withinPortal}>
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
              <Text size="sm" fw={600}>
                Pending decisions ({pendingIssues.length})
              </Text>
              <Group gap="xs">
                <Button size="compact-xs" variant="subtle" onClick={selectAll}>
                  Select all
                </Button>
                <Button size="compact-xs" variant="subtle" onClick={clearSelection}>
                  Clear
                </Button>
              </Group>
            </Group>
            <ScrollArea mah={300}>
              <Stack gap="xs">
                {pendingIssues.map((issue) => (
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
          placeholder="Additional fix instructions (optional)"
          size="xs"
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          autosize
          minRows={2}
          maxRows={4}
        />

        <Divider />
        <Group justify="flex-end">
          <Button
            size="sm"
            variant="light"
            disabled={blockingIssueCount > 0}
            onClick={handleContinue}
          >
            Continue with current draft
          </Button>
          <Button
            size="sm"
            variant="subtle"
            disabled={skippableIssueCount === 0}
            onClick={() => {
              onSkip();
              onClose();
            }}
          >
            Skip visual blockers
          </Button>
          <Button size="sm" onClick={handleFix} disabled={selectedCount === 0}>
            Fix selected ({selectedCount})
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
