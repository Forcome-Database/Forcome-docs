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

const DOCUMENT_REFERENCE_PATTERNS = [
  /\bdocument\b/i,
  /\bdocx?\b/i,
  /\bpdf\b/i,
  /\bfile\b/i,
  /\bmanual\b/i,
  /\u6587\u6863/,
  /\u6587\u4ef6/,
  /\u624b\u518c/,
];

const DOCUMENT_ATTACHMENT_PATTERNS = [
  /\battached\b/i,
  /\battachment\b/i,
  /\bupload(?:ed)?\b/i,
  /\u9644\u4ef6/,
  /\u4e0a\u4f20/,
  /\u9644\u4e0a/,
];

const DOCUMENT_DEICTIC_PATTERNS = [
  /\bthis\s+(?:document|docx?|pdf|file|manual)\b/i,
  /\bthe\s+(?:document|docx?|pdf|file|manual)\b/i,
  /\bthese\s+files\b/i,
  /\bthose\s+files\b/i,
  /\u8fd9(?:\u4e2a|\u4efd)?(?:\u6587\u6863|\u6587\u4ef6|\u624b\u518c)/,
  /\u8be5(?:\u6587\u6863|\u6587\u4ef6|\u624b\u518c)/,
];

const IMAGE_DEPENDENCY_PATTERNS = [
  /\bscreenshot\b/i,
  /\bimage\b/i,
  /\bpicture\b/i,
  /\bphoto\b/i,
  /\bdiagram\b/i,
  /\bui\b/i,
  /\u622a\u56fe/,
  /\u56fe\u7247/,
  /\u754c\u9762/,
];

const PAGE_CONTEXT_PATTERNS = [
  /\bcontinue this page\b/i,
  /\bcontinue the current page\b/i,
  /\bthis page\b/i,
  /\bextend this page\b/i,
  /\brewrite this page\b/i,
  /\u7ee7\u7eed\u8fd9(?:\u4e2a)?\u9875\u9762/,
  /\u7ee7\u7eed\u5f53\u524d\u9875\u9762/,
  /\u5f53\u524d\u9875\u9762/,
  /\u8fd9(?:\u4e2a)?\u9875\u9762/,
];

const SEARCH_REQUIRED_PATTERNS = [
  /\blatest\b/i,
  /\brecent\b/i,
  /\bupdate(?:s)?\b/i,
  /\bbest practices?\b/i,
  /\brequirements?\b/i,
  /\bwhat changed\b/i,
  /\b202\d\b/,
  /\u6700\u65b0/,
  /\u8fd1\u671f/,
  /\u53d8\u5316/,
  /\u6700\u4f73\u5b9e\u8df5/,
  /\u8981\u6c42/,
];

const REFERENCE_BOUNDED_SUMMARY_PATTERNS = [
  /\busing\s+https?:\/\/\S+.*\bsummar(?:ize|y)\b/i,
  /\bbased on\s+https?:\/\/\S+.*\bsummar(?:ize|y)\b/i,
  /\baccording to\s+https?:\/\/\S+.*\bsummar(?:ize|y)\b/i,
  /\busing\s+https?:\/\/\S+.*\brewrite\b/i,
  /\u53c2\u7167.*https?:\/\/\S+.*(\u603b\u7ed3|\u6539\u5199|\u4eff\u5199)/,
  /\u6839\u636e.*https?:\/\/\S+.*(\u603b\u7ed3|\u6539\u5199|\u4eff\u5199)/,
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

function requiresUploadedDocumentEvidence(
  prompt: string,
  documentFiles: UploadedFile[],
): boolean {
  if (!matchesAny(prompt, DOCUMENT_REFERENCE_PATTERNS)) {
    return false;
  }

  if (matchesAny(prompt, DOCUMENT_ATTACHMENT_PATTERNS)) {
    return true;
  }

  return (
    documentFiles.length > 0 && matchesAny(prompt, DOCUMENT_DEICTIC_PATTERNS)
  );
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
  const documentFiles = files.filter(isDocumentFile);

  for (const url of hasReferenceUrls) {
    requiredEvidence.push({
      type: 'reference_url',
      required: true,
      url,
    });
  }

  if (requiresUploadedDocumentEvidence(normalizedPrompt, documentFiles)) {
    addMissingDocumentEvidence(requiredEvidence, documentFiles);
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

  if (
    !(hasReferenceUrls.length > 0 && referenceBoundedSummary) &&
    requiresSearch
  ) {
    requiredEvidence.push({
      type: 'web_search',
      required: true,
    });
  }

  return { requiredEvidence };
}
