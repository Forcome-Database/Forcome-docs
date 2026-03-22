export interface AttachmentImageReference {
  id: string;
  fileName: string;
}

interface CanonicalizationMaps {
  attachmentsById: Map<string, AttachmentImageReference>;
  attachmentsByFileName: Map<string, AttachmentImageReference[]>;
}

export function canonicalizeAttachmentImageNodes(
  prosemirrorJson: any,
  attachments: AttachmentImageReference[],
): { document: any; changedCount: number } {
  if (!prosemirrorJson || !attachments.length) {
    return { document: prosemirrorJson, changedCount: 0 };
  }

  const maps = buildCanonicalizationMaps(attachments);
  let changedCount = 0;

  const visit = (node: any) => {
    if (!node || typeof node !== 'object') {
      return;
    }

    if (node.type === 'image' && node.attrs) {
      const attachment = resolveCanonicalAttachmentForImageNode(node.attrs, maps);
      if (attachment) {
        const canonicalSrc = buildCanonicalAttachmentUrl(attachment);
        if (
          node.attrs.attachmentId !== attachment.id ||
          node.attrs.src !== canonicalSrc
        ) {
          node.attrs.attachmentId = attachment.id;
          node.attrs.src = canonicalSrc;
          changedCount += 1;
        }
      }
    }

    if (Array.isArray(node.content)) {
      for (const child of node.content) {
        visit(child);
      }
    }
  };

  visit(prosemirrorJson);
  return {
    document: prosemirrorJson,
    changedCount,
  };
}

function buildCanonicalizationMaps(
  attachments: AttachmentImageReference[],
): CanonicalizationMaps {
  const attachmentsById = new Map(
    attachments.map((attachment) => [attachment.id, attachment]),
  );
  const attachmentsByFileName = new Map<string, AttachmentImageReference[]>();

  for (const attachment of attachments) {
    const fileName = attachment.fileName?.trim();
    if (!fileName) {
      continue;
    }
    const existing = attachmentsByFileName.get(fileName) || [];
    existing.push(attachment);
    attachmentsByFileName.set(fileName, existing);
  }

  return {
    attachmentsById,
    attachmentsByFileName,
  };
}

function resolveCanonicalAttachmentForImageNode(
  attrs: Record<string, any>,
  maps: CanonicalizationMaps,
): AttachmentImageReference | null {
  const attachmentId =
    typeof attrs.attachmentId === 'string' ? attrs.attachmentId : '';
  const src = typeof attrs.src === 'string' ? attrs.src : '';
  const match = src.match(/^\/(?:api\/)?files\/([^/]+)\/([^?\s#]+)/i);
  const srcAttachmentId = match?.[1] || '';
  const rawFileName = match?.[2] || '';
  const decodedFileName = safeDecodeURIComponent(rawFileName);

  if (attachmentId && maps.attachmentsById.has(attachmentId)) {
    return maps.attachmentsById.get(attachmentId) || null;
  }

  if (srcAttachmentId && maps.attachmentsById.has(srcAttachmentId)) {
    return maps.attachmentsById.get(srcAttachmentId) || null;
  }

  if (!decodedFileName) {
    return null;
  }

  const matches = maps.attachmentsByFileName.get(decodedFileName) || [];
  if (matches.length === 1) {
    return matches[0];
  }

  return null;
}

function buildCanonicalAttachmentUrl(attachment: AttachmentImageReference): string {
  return `/api/files/${attachment.id}/${encodeURIComponent(attachment.fileName)}`;
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
