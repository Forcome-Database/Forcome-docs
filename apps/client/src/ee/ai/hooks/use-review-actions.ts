import { useState, useCallback } from 'react';
import type { ReviewReport, ReviewIssue } from '../types/review.types';

export function resolveDefaultSelectedIssueIds(report: ReviewReport | null): string[] {
  if (!report) {
    return [];
  }

  const pendingIds = report.issues
    .filter((issue) => !issue.fixed && !issue.auto_fixable)
    .map((issue) => issue.id);

  if (!report.user_decision_needed.length) {
    return pendingIds;
  }

  const allowed = new Set(report.user_decision_needed);
  return pendingIds.filter((issueId) => allowed.has(issueId));
}

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
    setSelectedIssueIds(new Set(resolveDefaultSelectedIssueIds(report)));
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
