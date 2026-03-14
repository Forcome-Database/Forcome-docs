import { useState, useCallback } from 'react';
import type { ReviewReport, ReviewIssue } from '../types/review.types';

export function useReviewActions(report: ReviewReport | null) {
  const [selectedIssueIds, setSelectedIssueIds] = useState<Set<string>>(new Set());

  const toggleIssue = useCallback((issueId: string) => {
    setSelectedIssueIds(prev => {
      const next = new Set(prev);
      if (next.has(issueId)) next.delete(issueId);
      else next.add(issueId);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    if (!report) return;
    const ids = report.user_decision_needed;
    setSelectedIssueIds(new Set(ids));
  }, [report]);

  const clearSelection = useCallback(() => {
    setSelectedIssueIds(new Set());
  }, []);

  const pendingIssues = report?.issues.filter(i => !i.fixed && !i.auto_fixable) || [];
  const autoFixedIssues = report?.issues.filter(i => i.auto_fixable && i.fixed) || [];
  const selectedCount = selectedIssueIds.size;

  return {
    selectedIssueIds,
    toggleIssue,
    selectAll,
    clearSelection,
    pendingIssues,
    autoFixedIssues,
    selectedCount,
  };
}
