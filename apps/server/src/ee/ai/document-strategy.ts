import type { AiDocumentArtifact } from './document-plan';

export type AiIntentRoute =
  | 'selection_edit'
  | 'document_transform'
  | 'document_create';
export type AiIntentScope =
  | 'selection'
  | 'uploaded_document'
  | 'current_page'
  | 'blank_page';
export type AiSourcePolicy =
  | 'preserve_source'
  | 'transform_source'
  | 'create_new';
export type AiLengthPolicy = 'preserve' | 'compress' | 'expand';

export interface AiDocumentStrategy {
  templateKey: string;
  docType: string;
  audience: string;
  objectives: string[];
  requiredArtifacts: AiDocumentArtifact[];
  optionalArtifacts: AiDocumentArtifact[];
  requiredSections: string[];
  reviewChecks: string[];
  editorSyntaxHints: string[];
  intentRoute: AiIntentRoute;
  scope: AiIntentScope;
  sourcePolicy: AiSourcePolicy;
  lengthPolicy: AiLengthPolicy;
  prioritizeUserInstructions: boolean;
}

const COMMON_EDITOR_HINTS = [
  'Use Markdown tables when comparing options, parameters, or checklists.',
  'Use fenced code blocks with language tags for runnable code or commands.',
  'Use Mermaid blocks for architecture, process, or sequence explanations when a diagram materially improves understanding.',
  'Use Docmost callouts with :::info / :::warning / :::danger / :::success for tips, risks, and key takeaways.',
  'Use :::details blocks for collapsible supplementary material, not for core steps or conclusions.',
  'Use images with standard Markdown syntax ![alt](url) and explain why the image matters in surrounding text.',
];

const DEFAULT_STRATEGY: AiDocumentStrategy = {
  templateKey: 'general',
  docType: 'general-document',
  audience: 'knowledge worker reading and editing in Docmost',
  objectives: [
    'Answer the user request directly instead of padding with generic prose.',
    'Prefer evidence-backed statements and clearly mark uncertain claims.',
  ],
  requiredArtifacts: [],
  optionalArtifacts: ['table', 'code_block', 'callout'],
  requiredSections: [],
  reviewChecks: [
    'No filler introduction or conclusion.',
    'Each major section must have a clear purpose.',
    'Prefer compact structure over repetitive prose.',
  ],
  editorSyntaxHints: COMMON_EDITOR_HINTS,
  intentRoute: 'document_create',
  scope: 'blank_page',
  sourcePolicy: 'create_new',
  lengthPolicy: 'preserve',
  prioritizeUserInstructions: true,
};

const TEMPLATE_STRATEGIES: Record<string, Partial<AiDocumentStrategy>> = {
  'technical-doc': {
    docType: 'technical-documentation',
    audience: 'engineers and technical operators',
    objectives: [
      'Explain what the system does, how it works, and how to use it.',
      'Ground explanations in the provided materials and concrete examples.',
    ],
    requiredArtifacts: ['code_block'],
    optionalArtifacts: ['mermaid', 'table', 'callout', 'details'],
    requiredSections: ['overview', 'key concepts', 'usage or workflow'],
    reviewChecks: [
      'Technical claims should be specific and implementation-aware.',
      'Use at least one non-prose artifact when complexity warrants it.',
      'Examples should be runnable or concretely interpretable.',
    ],
  },
  'operation-manual': {
    docType: 'operations-manual',
    audience: 'frontline operators or non-technical users',
    objectives: [
      'Produce step-by-step instructions that can be executed without inference.',
      'Preserve or request visuals when they materially support a step.',
    ],
    requiredArtifacts: ['callout'],
    optionalArtifacts: ['table', 'image', 'details'],
    requiredSections: ['preparation', 'steps', 'verification', 'troubleshooting'],
    reviewChecks: [
      'Every critical step must include expected outcome or verification.',
      'Risky actions must include warnings.',
      'Use images when the source material contains relevant screenshots or diagrams.',
    ],
  },
  'meeting-notes': {
    docType: 'meeting-notes',
    audience: 'participants and stakeholders',
    objectives: [
      'Capture decisions, owners, and next steps clearly.',
      'Keep narrative concise and action-oriented.',
    ],
    requiredArtifacts: ['table'],
    optionalArtifacts: ['callout'],
    requiredSections: ['summary', 'discussion points', 'decisions', 'action items'],
    reviewChecks: [
      'Action items should include owners or placeholders for owners.',
      'Decisions and open questions must be distinguishable.',
    ],
  },
  requirements: {
    docType: 'requirements-analysis',
    audience: 'product, design, and engineering stakeholders',
    objectives: [
      'Translate user intent into concrete requirements and acceptance criteria.',
      'Make scope and non-goals explicit.',
    ],
    requiredArtifacts: ['table'],
    optionalArtifacts: ['mermaid', 'callout'],
    requiredSections: ['background', 'user scenarios', 'functional requirements', 'acceptance criteria'],
    reviewChecks: [
      'Requirements must be testable and not purely aspirational.',
      'Acceptance criteria should be explicit.',
    ],
  },
  report: {
    docType: 'research-report',
    audience: 'decision makers or analysts',
    objectives: [
      'Synthesize evidence into conclusions, not just excerpts.',
      'Show comparisons, trends, and implications clearly.',
    ],
    requiredArtifacts: ['table'],
    optionalArtifacts: ['mermaid', 'callout', 'image'],
    requiredSections: ['executive summary', 'findings', 'analysis', 'recommendations'],
    reviewChecks: [
      'Major claims should map to evidence or citations.',
      'Comparative statements should be normalized into tables when possible.',
    ],
  },
  prd: {
    docType: 'product-requirements-document',
    audience: 'product, design, engineering, and QA',
    objectives: [
      'Separate why, what, and how clearly.',
      'Produce implementation-ready requirements and validation criteria.',
    ],
    requiredArtifacts: ['table'],
    optionalArtifacts: ['mermaid', 'callout', 'details'],
    requiredSections: ['goals', 'user stories', 'functional design', 'acceptance criteria'],
    reviewChecks: [
      'Requirements must be testable.',
      'Risks, open questions, and dependencies should not be hidden in prose.',
    ],
  },
};

export function resolveAiDocumentStrategy(
  templateKey?: string | null,
  overrides?: Partial<
    Pick<
      AiDocumentStrategy,
      | 'intentRoute'
      | 'scope'
      | 'sourcePolicy'
      | 'lengthPolicy'
      | 'prioritizeUserInstructions'
    >
  >,
): AiDocumentStrategy {
  const key = templateKey || 'general';
  const override = TEMPLATE_STRATEGIES[key] || {};

  return {
    ...DEFAULT_STRATEGY,
    ...override,
    ...overrides,
    templateKey: key,
    objectives: override.objectives || DEFAULT_STRATEGY.objectives,
    requiredArtifacts:
      override.requiredArtifacts || DEFAULT_STRATEGY.requiredArtifacts,
    optionalArtifacts:
      override.optionalArtifacts || DEFAULT_STRATEGY.optionalArtifacts,
    requiredSections:
      override.requiredSections || DEFAULT_STRATEGY.requiredSections,
    reviewChecks: override.reviewChecks || DEFAULT_STRATEGY.reviewChecks,
    editorSyntaxHints:
      override.editorSyntaxHints || DEFAULT_STRATEGY.editorSyntaxHints,
    intentRoute: overrides?.intentRoute || DEFAULT_STRATEGY.intentRoute,
    scope: overrides?.scope || DEFAULT_STRATEGY.scope,
    sourcePolicy: overrides?.sourcePolicy || DEFAULT_STRATEGY.sourcePolicy,
    lengthPolicy: overrides?.lengthPolicy || DEFAULT_STRATEGY.lengthPolicy,
    prioritizeUserInstructions:
      overrides?.prioritizeUserInstructions ??
      DEFAULT_STRATEGY.prioritizeUserInstructions,
  };
}

export function formatDocumentStrategyForPrompt(
  strategy: AiDocumentStrategy,
): string {
  const lines = [
    'Document strategy:',
    `- Document type: ${strategy.docType}`,
    `- Audience: ${strategy.audience}`,
  ];

  if (strategy.objectives.length > 0) {
    lines.push('- Objectives:');
    for (const item of strategy.objectives) {
      lines.push(`  - ${item}`);
    }
  }

  if (strategy.requiredSections.length > 0) {
    lines.push('- Required sections:');
    for (const item of strategy.requiredSections) {
      lines.push(`  - ${item}`);
    }
  }

  if (strategy.requiredArtifacts.length > 0) {
    lines.push(`- Required artifacts: ${strategy.requiredArtifacts.join(', ')}`);
  }

  if (strategy.optionalArtifacts.length > 0) {
    lines.push(`- Optional artifacts: ${strategy.optionalArtifacts.join(', ')}`);
  }

  if (strategy.reviewChecks.length > 0) {
    lines.push('- Review checks:');
    for (const item of strategy.reviewChecks) {
      lines.push(`  - ${item}`);
    }
  }

  lines.push(`- Intent route: ${strategy.intentRoute}`);
  lines.push(`- Scope: ${strategy.scope}`);
  lines.push(`- Source policy: ${strategy.sourcePolicy}`);
  lines.push(`- Length policy: ${strategy.lengthPolicy}`);
  lines.push(
    `- User instructions have highest priority: ${strategy.prioritizeUserInstructions ? 'yes' : 'no'}`,
  );

  lines.push('- Editor syntax hints:');
  for (const item of strategy.editorSyntaxHints) {
    lines.push(`  - ${item}`);
  }

  return lines.join('\n');
}
