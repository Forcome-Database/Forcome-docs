import {
  type DocumentTaskMode,
  createDocumentTaskIntentDefaults,
} from "../types/document-task.types";

export type AiIntentRoute =
  | "selection_edit"
  | "document_transform"
  | "document_create";

export type AiIntentScope =
  | "selection"
  | "uploaded_document"
  | "uploaded_plus_current_page"
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
  documentTask?: ReturnType<typeof createDocumentTaskIntentDefaults>;
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

const RELAXED_OPTIMIZATION_KEYWORDS = [
  "reorganize",
  "restructure",
  "rewrite",
  "redraft",
  "rework",
  "重写",
  "改写",
  "重组",
  "重构结构",
  "重新组织",
];

const EXPLICIT_CURRENT_PAGE_JOIN_KEYWORDS = [
  "current page",
  "this page too",
  "also use the page",
  "also use current page",
  "combine with the current page",
  "include the current page",
  "当前页面",
  "本页",
  "页面内容也",
  "结合当前页面",
  "结合本页",
];

const EXPLICIT_CURRENT_PAGE_EXCLUSION_PATTERNS = [
  /\bdo not use (?:the )?current page\b/i,
  /\bdon't use (?:the )?current page\b/i,
  /\bwithout (?:the )?current page\b/i,
  /\bexclude (?:the )?current page\b/i,
  /\bignore (?:the )?current page\b/i,
  /\bskip (?:the )?current page\b/i,
  /\bdo not include (?:the )?current page\b/i,
  /\bdon't include (?:the )?current page\b/i,
  /\u4e0d\u8981\u4f7f\u7528(?:\u5f53\u524d\u9875\u9762|\u5f53\u524d\u9875|\u672c\u9875)/,
  /\u4e0d\u8981\u7528(?:\u5f53\u524d\u9875\u9762|\u5f53\u524d\u9875|\u672c\u9875)/,
  /\u4e0d\u4f7f\u7528(?:\u5f53\u524d\u9875\u9762|\u5f53\u524d\u9875|\u672c\u9875)/,
  /\u4e0d\u8981\u5305\u542b(?:\u5f53\u524d\u9875\u9762|\u5f53\u524d\u9875|\u672c\u9875)/,
  /\u6392\u9664(?:\u5f53\u524d\u9875\u9762|\u5f53\u524d\u9875|\u672c\u9875)/,
  /\u5ffd\u7565(?:\u5f53\u524d\u9875\u9762|\u5f53\u524d\u9875|\u672c\u9875)/,
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

function resolveDocumentTaskMode(prompt: string): DocumentTaskMode {
  const normalizedPrompt = normalizeText(prompt);
  return includesAny(normalizedPrompt, RELAXED_OPTIMIZATION_KEYWORDS)
    ? "relaxed_optimization"
    : "strict_preservation";
}

function shouldJoinCurrentPageContext(
  prompt: string,
  pageHasContent: boolean,
): boolean {
  if (!pageHasContent) {
    return false;
  }

  if (EXPLICIT_CURRENT_PAGE_EXCLUSION_PATTERNS.some((pattern) => pattern.test(prompt))) {
    return false;
  }

  return includesAny(normalizeText(prompt), EXPLICIT_CURRENT_PAGE_JOIN_KEYWORDS);
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
    const scope = shouldJoinCurrentPageContext(params.prompt, params.pageHasContent)
      ? "uploaded_plus_current_page"
      : "uploaded_document";

    return {
      route: "document_transform",
      scope,
      sourcePolicy: "preserve_source",
      lengthPolicy,
      documentTask: createDocumentTaskIntentDefaults(
        resolveDocumentTaskMode(params.prompt),
        scope,
      ),
      prioritizeUserInstructions: true,
      effectiveMode: "agent",
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
      documentTask: createDocumentTaskIntentDefaults(
        resolveDocumentTaskMode(params.prompt),
        "current_page",
      ),
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
