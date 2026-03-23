import {
  collectDocumentAssetSources,
  projectProsemirrorToContextText,
  projectProsemirrorToSearchText,
} from './content-projection';

describe('content projection', () => {
  const document = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Deployment guide' },
          { type: 'text', text: ' 点击下载', marks: [{ type: 'link', attrs: { href: 'http://74.211.105.94:3000/v2payse_US_2.yaml' } }] },
        ],
      },
      {
        type: 'attachment',
        attrs: {
          attachmentId: 'att-doc-1',
          name: 'runbook.pdf',
          url: '/api/files/att-doc-1/runbook.pdf',
          mime: 'application/pdf',
        },
      },
      {
        type: 'image',
        attrs: {
          attachmentId: 'att-img-1',
          src: '/api/files/att-img-1/diagram.png',
          alt: 'system diagram',
        },
      },
      {
        type: 'drawio',
        attrs: {
          attachmentId: 'att-dia-1',
          src: '/api/files/att-dia-1/flow.drawio',
          title: 'approval flow',
        },
      },
    ],
  };

  it('keeps generic attachments in search text', () => {
    const text = projectProsemirrorToSearchText(document);

    expect(text).toContain('Deployment guide');
    expect(text).toContain('http://74.211.105.94:3000/v2payse_US_2.yaml');
    expect(text).toContain('runbook.pdf');
    expect(text).toContain('system diagram');
    expect(text).toContain('approval flow');
  });

  it('renders public asset links in context text', () => {
    const text = projectProsemirrorToContextText(document, {
      resolveAssetUrl: (asset) => {
        const rawUrl = asset.rawUrl || `/api/files/${asset.attachmentId}/${asset.title}`;
        return `https://wiki.example${rawUrl.replace('/api/files/', '/api/files/public/')}?jwt=token`;
      },
      imageDescriptions: new Map([
        ['att-img-1', 'Architecture overview'],
      ]),
    });

    expect(text).toContain('[点击下载](http://74.211.105.94:3000/v2payse_US_2.yaml)');
    expect(text).toContain('[runbook.pdf](https://wiki.example/api/files/public/att-doc-1/runbook.pdf?jwt=token)');
    expect(text).toContain('![system diagram](https://wiki.example/api/files/public/att-img-1/diagram.png?jwt=token)');
    expect(text).toContain('[approval flow](https://wiki.example/api/files/public/att-dia-1/flow.drawio?jwt=token)');
  });

  it('collects page and asset source records', () => {
    const citations = collectDocumentAssetSources(document, {
      pageId: 'page-1',
      pageSlugId: 'deploy',
      pageTitle: 'Deploy',
      spaceSlug: 'ops',
      resolveAssetUrl: (asset) =>
        `https://wiki.example/api/files/public/${asset.attachmentId}/${asset.title}?jwt=token`,
    });

    expect(citations).toEqual([
      expect.objectContaining({
        sourceType: 'attachment',
        attachmentId: 'att-doc-1',
        title: 'runbook.pdf',
        pageSlugId: 'deploy',
        spaceSlug: 'ops',
        publicAssetUrl: 'https://wiki.example/api/files/public/att-doc-1/runbook.pdf?jwt=token',
      }),
      expect.objectContaining({
        sourceType: 'image',
        attachmentId: 'att-img-1',
        title: 'system diagram',
      }),
      expect.objectContaining({
        sourceType: 'diagram',
        attachmentId: 'att-dia-1',
        title: 'approval flow',
      }),
    ]);
  });
});
