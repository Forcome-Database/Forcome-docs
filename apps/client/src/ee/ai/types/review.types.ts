export type ReviewSeverity = 'error' | 'warning' | 'info';
export type ReviewCategory = 'length' | 'structure' | 'content' | 'style' | 'asset' | 'visual' | 'format';

export interface ReviewIssue {
  id: string;
  section_id: string | null;
  severity: ReviewSeverity;
  category: ReviewCategory;
  description: string;
  suggestion: string;
  auto_fixable: boolean;
  fixed: boolean;
}

export interface ReviewReport {
  overall_score: number;
  length_compliance: number;
  asset_reuse_rate: number;
  issues: ReviewIssue[];
  auto_fixed_count: number;
  user_decision_needed: string[];
}
