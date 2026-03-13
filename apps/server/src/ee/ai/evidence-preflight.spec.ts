import {
  deriveEvidencePreflight,
  extractReferencedUrls,
} from './evidence-preflight';

describe('evidence preflight', () => {
  it('extracts unique http(s) urls and rejects obvious non-web values', () => {
    expect(
      extractReferencedUrls(
        [
          'Use https://example.com/guide and http://docs.example.com.',
          'Ignore ftp://files.example.com and mailto:team@example.com.',
          'Deduplicate https://example.com/guide plus javascript:alert(1).',
          'Also ignore www.example.com/without-scheme.',
        ].join(' '),
      ),
    ).toEqual(['https://example.com/guide', 'http://docs.example.com']);
  });

  it('requires reference_url evidence for referenced external urls', () => {
    expect(
      deriveEvidencePreflight({
        prompt:
          'Compare the guidance in https://example.com/spec against our draft.',
      }),
    ).toEqual({
      requiredEvidence: [
        {
          type: 'reference_url',
          required: true,
          url: 'https://example.com/spec',
        },
      ],
    });
  });

  it('requires uploaded_document evidence when the prompt depends on attached documents', () => {
    expect(
      deriveEvidencePreflight({
        prompt: 'Summarize the attached PDF and preserve the original sections.',
        files: [
          {
            filename: 'system-design.pdf',
            mimetype: 'application/pdf',
          },
          {
            filename: 'notes.txt',
            mimetype: 'text/plain',
          },
        ],
      }),
    ).toEqual({
      requiredEvidence: [
        {
          type: 'uploaded_document',
          required: true,
          fileName: 'system-design.pdf',
        },
      ],
    });
  });

  it('declares missing uploaded_document evidence when the prompt depends on an attachment but none is present', () => {
    expect(
      deriveEvidencePreflight({
        prompt: 'Summarize the attached PDF and preserve the original sections.',
      }),
    ).toEqual({
      requiredEvidence: [
        {
          type: 'uploaded_document',
          required: true,
          missing: true,
        },
      ],
    });
  });

  it('requires uploaded_image evidence when the prompt depends on attached images', () => {
    expect(
      deriveEvidencePreflight({
        prompt: 'Describe the uploaded screenshot and extract the visible errors.',
        files: [
          {
            filename: 'ui-error.png',
            mimetype: 'image/png',
          },
          {
            filename: 'architecture.pdf',
            mimetype: 'application/pdf',
          },
        ],
      }),
    ).toEqual({
      requiredEvidence: [
        {
          type: 'uploaded_image',
          required: true,
          fileName: 'ui-error.png',
        },
      ],
    });
  });

  it('declares missing uploaded_image evidence when the prompt depends on a screenshot but none is present', () => {
    expect(
      deriveEvidencePreflight({
        prompt: 'Review the screenshot and explain the visible error state.',
      }),
    ).toEqual({
      requiredEvidence: [
        {
          type: 'uploaded_image',
          required: true,
          missing: true,
        },
      ],
    });
  });

  it('requires web_search evidence when the prompt needs outside facts and supplied evidence is insufficient', () => {
    expect(
      deriveEvidencePreflight({
        prompt:
          'What are the latest SOC 2 requirements for 2026, and how do they compare with ISO 27001 updates?',
      }),
    ).toEqual({
      requiredEvidence: [
        {
          type: 'web_search',
          required: true,
        },
      ],
    });
  });

  it('does not require web_search when referenced urls already supply outside evidence', () => {
    expect(
      deriveEvidencePreflight({
        prompt:
          'Using https://example.com/release-notes, summarize the latest product changes.',
      }),
    ).toEqual({
      requiredEvidence: [
        {
          type: 'reference_url',
          required: true,
          url: 'https://example.com/release-notes',
        },
      ],
    });
  });

  it('keeps web_search required when a referenced url is compared against fresh external facts', () => {
    expect(
      deriveEvidencePreflight({
        prompt:
          'Compare https://example.com/spec with the latest SOC 2 requirements for 2026.',
      }),
    ).toEqual({
      requiredEvidence: [
        {
          type: 'reference_url',
          required: true,
          url: 'https://example.com/spec',
        },
        {
          type: 'web_search',
          required: true,
        },
      ],
    });
  });

  it('requires page_context evidence when the prompt asks to continue the current page', () => {
    expect(
      deriveEvidencePreflight({
        prompt: 'Continue this page with a troubleshooting section.',
        pageContext: {
          pageId: 'page-123',
          pageTitle: 'Incident runbook',
          pageContent: '# Incident runbook\n\nCurrent draft',
        },
      }),
    ).toEqual({
      requiredEvidence: [
        {
          type: 'page_context',
          required: true,
          pageId: 'page-123',
        },
      ],
    });
  });

  it('declares missing page_context evidence when the prompt asks to continue the current page but none is available', () => {
    expect(
      deriveEvidencePreflight({
        prompt: 'Continue this page with a troubleshooting section.',
      }),
    ).toEqual({
      requiredEvidence: [
        {
          type: 'page_context',
          required: true,
          missing: true,
        },
      ],
    });
  });

  it('keeps web_search required when uploaded evidence is present but freshness still matters', () => {
    expect(
      deriveEvidencePreflight({
        prompt:
          'Compare the attached DOCX with the latest 2026 SOC 2 requirements.',
        files: [
          {
            filename: 'controls.docx',
            mimetype:
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          },
        ],
      }),
    ).toEqual({
      requiredEvidence: [
        {
          type: 'uploaded_document',
          required: true,
          fileName: 'controls.docx',
        },
        {
          type: 'web_search',
          required: true,
        },
      ],
    });
  });

  it('does not require web_search for local-only comparisons of uploaded images', () => {
    expect(
      deriveEvidencePreflight({
        prompt: 'Compare the two uploaded screenshots and explain the UI differences.',
        files: [
          {
            filename: 'before.png',
            mimetype: 'image/png',
          },
          {
            filename: 'after.png',
            mimetype: 'image/png',
          },
        ],
      }),
    ).toEqual({
      requiredEvidence: [
        {
          type: 'uploaded_image',
          required: true,
          fileName: 'before.png',
        },
        {
          type: 'uploaded_image',
          required: true,
          fileName: 'after.png',
        },
      ],
    });
  });

  it('returns all required evidence categories without duplicates for mixed prompts', () => {
    expect(
      deriveEvidencePreflight({
        prompt: [
          'Continue this page by incorporating the attached DOCX findings,',
          'review the uploaded screenshot,',
          'and compare both with https://example.com/policy.',
        ].join(' '),
        files: [
          {
            filename: 'findings.docx',
            mimetype:
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          },
          {
            filename: 'screenshot.jpg',
            mimetype: 'image/jpeg',
          },
        ],
        pageContext: {
          pageId: 'page-456',
          pageTitle: 'Policy draft',
          pageContent: 'Existing draft',
        },
      }),
    ).toEqual({
      requiredEvidence: [
        {
          type: 'reference_url',
          required: true,
          url: 'https://example.com/policy',
        },
        {
          type: 'uploaded_document',
          required: true,
          fileName: 'findings.docx',
        },
        {
          type: 'uploaded_image',
          required: true,
          fileName: 'screenshot.jpg',
        },
        {
          type: 'page_context',
          required: true,
          pageId: 'page-456',
        },
      ],
    });
  });
});
