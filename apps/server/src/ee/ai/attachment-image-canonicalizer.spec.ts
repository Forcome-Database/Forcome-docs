import {
  canonicalizeAttachmentImageNodes,
  type AttachmentImageReference,
} from './attachment-image-canonicalizer';

describe('attachment-image-canonicalizer', () => {
  it('repairs malformed internal attachment URLs by matching the page attachment filename', () => {
    const document = {
      type: 'doc',
      content: [
        {
          type: 'image',
          attrs: {
            src: '/api/files/019d159b-ca8-734c-9306-2d45bd0cad65/clash%E9%85%8D%E7%BD%AE%E6%95%99%E7%A8%8B_8249b1b5.jpg',
          },
        },
      ],
    };
    const attachments: AttachmentImageReference[] = [
      {
        id: '019d159b-9ca8-734c-9306-2d45bd0cad65',
        fileName: 'clash配置教程_8249b1b5.jpg',
      },
    ];

    const result = canonicalizeAttachmentImageNodes(document, attachments);

    expect(result.changedCount).toBe(1);
    expect(result.document).toEqual({
      type: 'doc',
      content: [
        {
          type: 'image',
          attrs: {
            attachmentId: '019d159b-9ca8-734c-9306-2d45bd0cad65',
            src: '/api/files/019d159b-9ca8-734c-9306-2d45bd0cad65/clash%E9%85%8D%E7%BD%AE%E6%95%99%E7%A8%8B_8249b1b5.jpg',
          },
        },
      ],
    });
  });

  it('normalizes src to the canonical attachment route when attachmentId is already valid', () => {
    const document = {
      type: 'doc',
      content: [
        {
          type: 'image',
          attrs: {
            attachmentId: 'att-1',
            src: '/api/files/att-1/old-name.jpg',
          },
        },
      ],
    };
    const attachments: AttachmentImageReference[] = [
      {
        id: 'att-1',
        fileName: 'real name.jpg',
      },
    ];

    const result = canonicalizeAttachmentImageNodes(document, attachments);

    expect(result.changedCount).toBe(1);
    expect(result.document).toEqual({
      type: 'doc',
      content: [
        {
          type: 'image',
          attrs: {
            attachmentId: 'att-1',
            src: '/api/files/att-1/real%20name.jpg',
          },
        },
      ],
    });
  });

  it('leaves ambiguous filename matches unchanged', () => {
    const document = {
      type: 'doc',
      content: [
        {
          type: 'image',
          attrs: {
            src: '/api/files/missing/duplicate.png',
          },
        },
      ],
    };
    const attachments: AttachmentImageReference[] = [
      { id: 'att-1', fileName: 'duplicate.png' },
      { id: 'att-2', fileName: 'duplicate.png' },
    ];

    const result = canonicalizeAttachmentImageNodes(document, attachments);

    expect(result.changedCount).toBe(0);
    expect(result.document).toEqual(document);
  });
});
