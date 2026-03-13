export type AiIntentRoute =
  | "selection_edit"
  | "document_transform"
  | "document_create";

export type AiIntentScope =
  | "selection"
  | "uploaded_document"
  | "current_page"
  | "blank_page";

export type AiSourcePolicy =
  | "preserve_source"
  | "transform_source"
  | "create_new";

export type AiLengthPolicy = "preserve" | "compress" | "expand";

export interface ResolveAiIntentParams {
  prompt: string;
  selection: string;
  files: File[];
  pageHasContent: boolean;
  agentMode: boolean;
}

export interface ResolvedAiIntent {
  route: AiIntentRoute;
  scope: AiIntentScope;
  sourcePolicy: AiSourcePolicy;
  lengthPolicy: AiLengthPolicy;
  prioritizeUserInstructions: true;
  effectiveMode: "standard" | "agent";
}

const COMPRESS_KEYWORDS = [
  "summary",
  "summarize",
  "condense",
  "compress",
  "shorten",
  "trim",
  "brief",
  "tl;dr",
  "摘要",
  "总结",
  "精简",
  "压缩",
  "缩短",
  "简短",
];

const PRESERVE_LENGTH_KEYWORDS = [
  "do not shorten",
  "don't shorten",
  "do not compress",
  "don't compress",
  "do not summarize",
  "don't summarize",
  "keep the length",
  "keep all details",
  "保留长度",
  "不要缩短",
  "不要压缩",
  "不要总结",
  "不要摘要",
  "保留细节",
  "不要删减",
];

const EXPAND_KEYWORDS = [
  "expand",
  "elaborate",
  "extend",
  "detail",
  "more detailed",
  "补充",
  "扩写",
  "展开",
  "详细",
  "细化",
];

function normalizeText(text: string): string {
  return text.trim().toLowerCase();
}

function includesAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

function resolveLengthPolicy(prompt: string): AiLengthPolicy {
  const normalizedPrompt = normalizeText(prompt);
  if (includesAny(normalizedPrompt, PRESERVE_LENGTH_KEYWORDS)) {
    return "preserve";
  }

  if (includesAny(normalizedPrompt, COMPRESS_KEYWORDS)) {
    return "compress";
  }

  if (includesAny(normalizedPrompt, EXPAND_KEYWORDS)) {
    return "expand";
  }

  return "preserve";
}

export function resolveAiIntent(
  params: ResolveAiIntentParams,
): ResolvedAiIntent {
  const lengthPolicy = resolveLengthPolicy(params.prompt);

  if (params.selection.trim()) {
    return {
      route: "selection_edit",
      scope: "selection",
      sourcePolicy: "transform_source",
      lengthPolicy,
      prioritizeUserInstructions: true,
      effectiveMode: params.agentMode ? "agent" : "standard",
    };
  }

  if (params.files.length > 0) {
    return {
      route: "document_transform",
      scope: "uploaded_document",
      sourcePolicy: "preserve_source",
      lengthPolicy,
      prioritizeUserInstructions: true,
      effectiveMode: params.agentMode ? "agent" : "standard",
    };
  }

  if (params.pageHasContent) {
    return {
      route: "document_transform",
      scope: "current_page",
      sourcePolicy: "preserve_source",
      lengthPolicy,
      prioritizeUserInstructions: true,
      effectiveMode: params.agentMode ? "agent" : "standard",
    };
  }

  return {
    route: "document_create",
    scope: "blank_page",
    sourcePolicy: "create_new",
    lengthPolicy,
    prioritizeUserInstructions: true,
    effectiveMode: params.agentMode ? "agent" : "standard",
  };
}
