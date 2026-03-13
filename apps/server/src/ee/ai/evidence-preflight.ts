type EvidenceType =
  | 'reference_url'
  | 'uploaded_document'
  | 'uploaded_image'
  | 'page_context'
  | 'web_search';

type UploadedFile = {
  filename: string;
  mimetype: string;
};

type PageContext = {
  pageId?: string;
  pageTitle?: string;
  pageContent?: string;
};

type EvidenceRequirement =
  | {
      type: 'reference_url';
      required: true;
      url: string;
    }
  | {
      type: 'uploaded_document';
      required: true;
      fileName: string;
    }
  | {
      type: 'uploaded_document';
      required: true;
      missing: true;
    }
  | {
      type: 'uploaded_image';
      required: true;
      fileName: string;
    }
  | {
      type: 'uploaded_image';
      required: true;
      missing: true;
    }
  | {
      type: 'page_context';
      required: true;
      pageId: string;
    }
  | {
      type: 'page_context';
      required: true;
      missing: true;
    }
  | {
      type: 'web_search';
      required: true;
    };

type DeriveEvidencePreflightParams = {
  prompt: string;
  files?: UploadedFile[];
  pageContext?: PageContext;
};

export type EvidencePreflight = {
  requiredEvidence: EvidenceRequirement[];
};

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"'`)\]]+/gi;
const TRAILING_PUNCTUATION = /[.,;:!?]+$/;

const DOCUMENT_MIME_PREFIXES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/markdown',
  'text/html',
];

const IMAGE_MIME_PREFIXES = ['image/'];

const DOCUMENT_DEPENDENCY_PATTERNS = [
  /\bdocument\b/i,
  /\bdocx?\b/i,
  /\bpdf\b/i,
  /\bfile\b/i,
  /\bmanual\b/i,
  /附件/,
  /上传/,
  /文档/,
  /文件/,
  /手册/,
];

const IMAGE_DEPENDENCY_PATTERNS = [
  /\bscreenshot\b/i,
  /\bimage\b/i,
  /\bpicture\b/i,
  /\bphoto\b/i,
  /\bdiagram\b/i,
  /\bui\b/i,
  /截图/,
  /图片/,
  /界面/,
];

const PAGE_CONTEXT_PATTERNS = [
  /\bcontinue this page\b/i,
  /\bcontinue the current page\b/i,
  /\bthis page\b/i,
  /\bextend this page\b/i,
  /\brewrite this page\b/i,
  /继续这个页面/,
  /继续当前页面/,
  /当前页面/,
  /这个页面/,
];

const SEARCH_REQUIRED_PATTERNS = [
  /\blatest\b/i,
  /\brecent\b/i,
  /\bupdate(?:s)?\b/i,
  /\bbest practices?\b/i,
  /\brequirements?\b/i,
  /\bwhat changed\b/i,
  /\b202\d\b/,
  /最新/,
  /近期/,
  /变化/,
  /最佳实践/,
  /要求/,
];

const REFERENCE_BOUNDED_SUMMARY_PATTERNS = [
  /\busing\s+https?:\/\/\S+.*\bsummar(?:ize|y)\b/i,
  /\bbased on\s+https?:\/\/\S+.*\bsummar(?:ize|y)\b/i,
  /\baccording to\s+https?:\/\/\S+.*\bsummar(?:ize|y)\b/i,
  /\busing\s+https?:\/\/\S+.*\brewrite\b/i,
  /参照.*https?:\/\/\S+.*(总结|改写|仿写)/,
  /根据.*https?:\/\/\S+.*(总结|改写|仿写)/,
];

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function isDocumentFile(file: UploadedFile): boolean {
  return DOCUMENT_MIME_PREFIXES.some((prefix) =>
    file.mimetype.startsWith(prefix),
  );
}

function isImageFile(file: UploadedFile): boolean {
  return IMAGE_MIME_PREFIXES.some((prefix) => file.mimetype.startsWith(prefix));
}

function addMissingDocumentEvidence(
  requiredEvidence: EvidenceRequirement[],
  documentFiles: UploadedFile[],
): void {
  if (documentFiles.length === 0) {
    requiredEvidence.push({
      type: 'uploaded_document',
      required: true,
      missing: true,
    });
    return;
  }

  for (const file of documentFiles) {
    requiredEvidence.push({
      type: 'uploaded_document',
      required: true,
      fileName: file.filename,
    });
  }
}

function addImageEvidence(
  requiredEvidence: EvidenceRequirement[],
  imageFiles: UploadedFile[],
): void {
  if (imageFiles.length === 0) {
    requiredEvidence.push({
      type: 'uploaded_image',
      required: true,
      missing: true,
    });
    return;
  }

  for (const file of imageFiles) {
    requiredEvidence.push({
      type: 'uploaded_image',
      required: true,
      fileName: file.filename,
    });
  }
}

export function extractReferencedUrls(text: string): string[] {
  const matches = text.match(URL_PATTERN) || [];
  const unique = new Set<string>();

  for (const rawMatch of matches) {
    const trimmed = rawMatch.replace(TRAILING_PUNCTUATION, '');

    try {
      const parsed = new URL(trimmed);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        continue;
      }

      const normalized =
        parsed.pathname === '/' && !parsed.search && !parsed.hash
          ? parsed.origin
          : parsed.toString();
      unique.add(normalized);
    } catch {
      continue;
    }
  }

  return Array.from(unique);
}

export function deriveEvidencePreflight({
  prompt,
  files = [],
  pageContext,
}: DeriveEvidencePreflightParams): EvidencePreflight {
  const normalizedPrompt = prompt.trim();
  const requiredEvidence: EvidenceRequirement[] = [];
  const hasReferenceUrls = extractReferencedUrls(normalizedPrompt);

  for (const url of hasReferenceUrls) {
    requiredEvidence.push({
      type: 'reference_url',
      required: true,
      url,
    });
  }

  if (matchesAny(normalizedPrompt, DOCUMENT_DEPENDENCY_PATTERNS)) {
    addMissingDocumentEvidence(requiredEvidence, files.filter(isDocumentFile));
  }

  if (matchesAny(normalizedPrompt, IMAGE_DEPENDENCY_PATTERNS)) {
    addImageEvidence(requiredEvidence, files.filter(isImageFile));
  }

  if (matchesAny(normalizedPrompt, PAGE_CONTEXT_PATTERNS)) {
    if (pageContext?.pageId) {
      requiredEvidence.push({
        type: 'page_context',
        required: true,
        pageId: pageContext.pageId,
      });
    } else {
      requiredEvidence.push({
        type: 'page_context',
        required: true,
        missing: true,
      });
    }
  }

  const requiresSearch = matchesAny(normalizedPrompt, SEARCH_REQUIRED_PATTERNS);
  const referenceBoundedSummary = matchesAny(
    normalizedPrompt,
    REFERENCE_BOUNDED_SUMMARY_PATTERNS,
  );

  if (!(hasReferenceUrls.length > 0 && referenceBoundedSummary) && requiresSearch) {
    requiredEvidence.push({
      type: 'web_search',
      required: true,
    });
  }

  return { requiredEvidence };
}
