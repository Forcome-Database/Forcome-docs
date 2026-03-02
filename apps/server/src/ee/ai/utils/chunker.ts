export interface TextChunk {
  text: string;
  chunkIndex: number;
  chunkStart: number;
  chunkLength: number;
}

interface Segment {
  text: string;
  start: number;
  splittable: boolean;
}

function splitBySentenceBoundary(
  text: string,
  offset: number,
  maxChars: number,
  overlapRatio: number,
): TextChunk[] {
  const chunks: TextChunk[] = [];
  const overlap = Math.floor(maxChars * overlapRatio);
  let pos = 0;

  while (pos < text.length) {
    const remaining = text.length - pos;
    if (remaining <= maxChars) {
      chunks.push({
        text: text.slice(pos),
        chunkIndex: -1,
        chunkStart: offset + pos,
        chunkLength: remaining,
      });
      break;
    }

    const window = text.slice(pos, pos + maxChars);
    const minSplit = Math.floor(maxChars * 0.5);
    let splitAt = maxChars;

    for (let i = window.length - 1; i >= minSplit; i--) {
      const ch = window[i];
      const prev = window[i - 1];
      if (ch === '。' || ch === '！' || ch === '？') {
        splitAt = i + 1;
        break;
      }
      if (ch === '\n') {
        splitAt = i + 1;
        break;
      }
      if (
        (ch === ' ' || ch === '\t') &&
        (prev === '.' || prev === '!' || prev === '?')
      ) {
        splitAt = i + 1;
        break;
      }
    }

    chunks.push({
      text: window.slice(0, splitAt),
      chunkIndex: -1,
      chunkStart: offset + pos,
      chunkLength: splitAt,
    });

    pos += splitAt - overlap;
    if (pos < 0) pos = 0;
  }

  return chunks;
}

function segmentByCodeBlocks(text: string): Segment[] {
  const segments: Segment[] = [];
  const pattern = /```[\s\S]*?```/g;
  let lastEnd = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastEnd) {
      segments.push({
        text: text.slice(lastEnd, match.index),
        start: lastEnd,
        splittable: true,
      });
    }
    segments.push({
      text: match[0],
      start: match.index,
      splittable: false,
    });
    lastEnd = match.index + match[0].length;
  }

  if (lastEnd < text.length) {
    segments.push({
      text: text.slice(lastEnd),
      start: lastEnd,
      splittable: true,
    });
  }

  return segments;
}

export function chunkText(
  text: string,
  maxChars = 1600,
  overlapRatio = 0.2,
): TextChunk[] {
  if (!text || !text.trim()) {
    return [];
  }

  if (text.length <= maxChars) {
    return [
      {
        text,
        chunkIndex: 0,
        chunkStart: 0,
        chunkLength: text.length,
      },
    ];
  }

  const segments = segmentByCodeBlocks(text);
  const rawChunks: TextChunk[] = [];

  for (const segment of segments) {
    if (segment.splittable) {
      const sub = splitBySentenceBoundary(
        segment.text,
        segment.start,
        maxChars,
        overlapRatio,
      );
      rawChunks.push(...sub);
    } else {
      rawChunks.push({
        text: segment.text,
        chunkIndex: -1,
        chunkStart: segment.start,
        chunkLength: segment.text.length,
      });
    }
  }

  for (let i = 0; i < rawChunks.length; i++) {
    rawChunks[i].chunkIndex = i;
  }

  return rawChunks;
}
