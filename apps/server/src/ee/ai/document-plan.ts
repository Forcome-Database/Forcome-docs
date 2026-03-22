import type { DocumentTaskDiffGranularity } from './document-tasks/document-task.types';

export const AI_DOCUMENT_ARTIFACTS = [
  'table',
  'mermaid',
  'code_block',
  'image',
  'callout',
  'details',
] as const;

export const AI_DOCUMENT_EVIDENCE_SOURCES = [
  'uploaded_files',
  'page_context',
  'page_read',
  'knowledge_search',
  'web_search',
  'web_crawl',
  'vision',
  'generated_image',
] as const;

export type AiDocumentArtifact = (typeof AI_DOCUMENT_ARTIFACTS)[number];
export type AiDocumentEvidenceSource =
  (typeof AI_DOCUMENT_EVIDENCE_SOURCES)[number];

export interface AiDocumentPlanSection {
  id: string;
  title: string;
  goal: string;
  artifacts: AiDocumentArtifact[];
  must_cover: string[];
  evidence: AiDocumentEvidenceSource[];
}

export interface AiDocumentPlan {
  doc_type: string;
  audience: string;
  required_artifacts: AiDocumentArtifact[];
  sections: AiDocumentPlanSection[];
  review_defaults: {
    review_mode: 'diff_first';
    default_granularity: 'block';
    supported_granularity: DocumentTaskDiffGranularity[];
  };
}

interface AiDocumentPlanStrategyDefaults {
  docType?: string;
  audience?: string;
  requiredArtifacts?: string[];
  requiredSections?: string[];
}

const EVIDENCE_SOURCE_ALIASES: Record<string, AiDocumentEvidenceSource> = {
  search: 'web_search',
  crawl: 'web_crawl',
  knowledge_base: 'knowledge_search',
  image: 'generated_image',
  image_generation: 'generated_image',
};

function normalizeArtifacts(raw: unknown): AiDocumentArtifact[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const normalized: AiDocumentArtifact[] = [];
  for (const item of raw) {
    const candidate = String(item || '').trim();
    if (
      AI_DOCUMENT_ARTIFACTS.includes(candidate as AiDocumentArtifact) &&
      !normalized.includes(candidate as AiDocumentArtifact)
    ) {
      normalized.push(candidate as AiDocumentArtifact);
    }
  }
  return normalized;
}

function normalizeEvidenceSources(raw: unknown): AiDocumentEvidenceSource[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const normalized: AiDocumentEvidenceSource[] = [];
  for (const item of raw) {
    const value = String(item || '').trim();
    const candidate = EVIDENCE_SOURCE_ALIASES[value] || value;
    if (
      AI_DOCUMENT_EVIDENCE_SOURCES.includes(
        candidate as AiDocumentEvidenceSource,
      ) &&
      !normalized.includes(candidate as AiDocumentEvidenceSource)
    ) {
      normalized.push(candidate as AiDocumentEvidenceSource);
    }
  }
  return normalized;
}

export function normalizeAiDocumentPlan(
  raw: unknown,
  strategy?: AiDocumentPlanStrategyDefaults | null,
): AiDocumentPlan {
  const plan =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const requiredSections = Array.isArray(strategy?.requiredSections)
    ? strategy.requiredSections
    : [];
  const strategyArtifacts = normalizeArtifacts(strategy?.requiredArtifacts);
  const rawSections = Array.isArray(plan.sections) ? plan.sections : [];
  const sectionsSource =
    rawSections.length > 0
      ? rawSections
      : requiredSections.map((title) => ({
          title,
          goal: title,
          artifacts: strategyArtifacts,
          must_cover: [],
          evidence: [],
        }));

  const sections: AiDocumentPlanSection[] = [];
  for (const [index, section] of sectionsSource.entries()) {
    if (!section || typeof section !== 'object' || Array.isArray(section)) {
      continue;
    }

    const sectionRecord = section as Record<string, unknown>;
    const title = String(sectionRecord.title || `Section ${index + 1}`);
    sections.push({
      id: String(sectionRecord.id || `section-${index + 1}`),
      title,
      goal: String(sectionRecord.goal || title),
      artifacts: normalizeArtifacts(sectionRecord.artifacts),
      must_cover: Array.isArray(sectionRecord.must_cover)
        ? Array.from(
            new Set(
              sectionRecord.must_cover
                .map((item) => String(item || '').trim())
                .filter(Boolean),
            ),
          )
        : [],
      evidence: normalizeEvidenceSources(sectionRecord.evidence),
    });
  }

  return {
    doc_type: String(plan.doc_type || strategy?.docType || 'general-document'),
    audience: String(plan.audience || strategy?.audience || ''),
    required_artifacts: normalizeArtifacts(
      plan.required_artifacts || strategyArtifacts,
    ),
    sections,
    review_defaults: {
      review_mode: 'diff_first',
      default_granularity: 'block',
      supported_granularity: ['block', 'text'],
    },
  };
}
