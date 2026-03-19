import type { ImageStrategy } from './source-assets.types';

export interface CreationBrief {
  audience: string;
  goal: string;
  target_length: number;
  length_tolerance: number;
  style: string;
  tone: string;
  structure_strategy: 'copy_source' | 'ai_recommend' | 'user_defined';
  image_strategy: ImageStrategy;
  constraints: string[];
}
