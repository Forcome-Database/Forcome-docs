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
  "\u6458\u8981",
  "\u603b\u7ed3",
  "\u7cbe\u7b80",
  "\u538b\u7f29",
  "\u7f29\u77ed",
  "\u7b80\u77ed",
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
  "\u4fdd\u7559\u957f\u5ea6",
  "\u4e0d\u8981\u7f29\u77ed",
  "\u4e0d\u8981\u538b\u7f29",
  "\u4e0d\u8981\u603b\u7ed3",
  "\u4e0d\u8981\u6458\u8981",
  "\u4fdd\u7559\u7ec6\u8282",
  "\u4e0d\u8981\u5220\u51cf",
];

const EXPAND_KEYWORDS = [
  "expand",
  "elaborate",
  "extend",
  "detail",
  "more detailed",
  "\u8865\u5145",
  "\u6269\u5199",
  "\u5c55\u5f00",
  "\u8be6\u7ec6",
  "\u7ec6\u5316",
];

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"'`)\]]+/i;

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

function hasReferenceUrl(prompt: string): boolean {
  return URL_PATTERN.test(prompt);
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

  if (hasReferenceUrl(params.prompt)) {
    return {
      route: "document_transform",
      scope: "blank_page",
      sourcePolicy: "transform_source",
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
