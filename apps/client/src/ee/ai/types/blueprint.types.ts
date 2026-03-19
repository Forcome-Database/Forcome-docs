import type { SourceImageCandidate } from './source-assets.types';

export interface VisualPlan {
  type: 'mermaid' | 'ai_image' | 'reuse_image' | 'table';
  description: string;
  source_asset_id: string | null;
  position: 'before_section' | 'after_paragraph' | 'end_of_section';
}

export interface SectionPlan {
  id: string;
  title: string;
  level: number;
  word_budget: number;
  description: string;
  assets: string[];
  visuals: VisualPlan[];
  visual_candidates?: SourceImageCandidate[];
  must_cover: string[];
}

export interface CreationBlueprint {
  title: string;
  sections: SectionPlan[];
  total_word_budget: number;
  style_guide: string;
  visual_plan_summary: string;
}

export interface AssetItem {
  id: string;
  type: 'text' | 'image' | 'table' | 'code' | 'mermaid' | 'heading_structure';
  source: string;
  content: string;
  summary: string;
  suggested_usage: string;
  reuse_decision: 'reuse' | 'adapt' | 'skip' | null;
}

export interface AssetMap {
  items: AssetItem[];
  source_structure: Record<string, unknown>[];
  source_word_count: number;
  source_section_counts: Record<string, number>;
}
