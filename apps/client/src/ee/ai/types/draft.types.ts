export interface SectionDraft {
  section_id: string;
  content: string;
  word_count: number;
  budget_compliance: number;
  assets_used: string[];
  visuals_generated: string[];
}

export interface DraftState {
  sections: SectionDraft[];
  blueprint_ref: string;
  created_at: string;
  updated_at: string;
}
