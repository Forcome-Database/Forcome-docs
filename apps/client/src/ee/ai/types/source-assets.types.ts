export type CanonicalImageStrategy =
  | 'reuse_source_only'
  | 'prefer_source_then_generate'
  | 'generate_new_only'
  | 'none';

export type LegacyImageStrategy =
  | 'reuse_source'
  | 'generate_new'
  | 'mixed';

export type ImageStrategy = CanonicalImageStrategy | LegacyImageStrategy;

export interface SourceImageCandidate {
  asset_id: string;
  score: number;
  caption: string;
  source: string;
  source_page: number | null;
  source_heading: string;
  rationale: string;
}

export function normalizeImageStrategy(strategy: ImageStrategy): CanonicalImageStrategy {
  switch (strategy) {
    case 'reuse_source':
      return 'reuse_source_only';
    case 'mixed':
      return 'prefer_source_then_generate';
    case 'generate_new':
      return 'generate_new_only';
    default:
      return strategy;
  }
}

export function imageStrategyLabel(strategy: ImageStrategy): string {
  switch (normalizeImageStrategy(strategy)) {
    case 'reuse_source_only':
      return 'Reuse source images only';
    case 'prefer_source_then_generate':
      return 'Prefer source images, fallback to generate';
    case 'generate_new_only':
      return 'Generate new images only';
    case 'none':
      return 'No images';
  }
}
