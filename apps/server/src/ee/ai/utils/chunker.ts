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

function splitByHeadings(text: string): Array<{ text: string; start: number; heading: string }> {
  // First, identify code block ranges to exclude
  const codeBlockRanges: Array<[number, number]> = [];
  const codePattern = /```[\s\S]*?```/g;
  let codeMatch: RegExpExecArray | null;
  while ((codeMatch = codePattern.exec(text)) !== null) {
    codeBlockRanges.push([codeMatch.index, codeMatch.index + codeMatch[0].length]);
  }

  const isInsideCodeBlock = (pos: number): boolean =>
    codeBlockRanges.some(([start, end]) => pos >= start && pos < end);

  const sections: Array<{ text: string; start: number; heading: string }> = [];
  const headingPattern = /^(#{1,6})\s+(.+)$/gm;
  let lastEnd = 0;
  let lastHeading = '';
  let match: RegExpExecArray | null;

  while ((match = headingPattern.exec(text)) !== null) {
    if (isInsideCodeBlock(match.index)) continue;

    if (match.index > lastEnd) {
      sections.push({ text: text.slice(lastEnd, match.index), start: lastEnd, heading: lastHeading });
    }
    lastHeading = match[2].trim();
    lastEnd = match.index;
  }

  if (lastEnd < text.length) {
    sections.push({ text: text.slice(lastEnd), start: lastEnd, heading: lastHeading });
  }

  return sections.filter(s => s.text.trim().length > 0);
}

export function chunkText(
  text: string,
  maxChars = 1600,
  overlapRatio = 0.2,
): TextChunk[] {
  if (!text || !text.trim()) {
    return [];
  }

  const sections = splitByHeadings(text);

  // Only short-circuit for small text without headings
  if (text.length <= maxChars && sections.length <= 1) {
    return [
      {
        text,
        chunkIndex: 0,
        chunkStart: 0,
        chunkLength: text.length,
      },
    ];
  }
  const rawChunks: TextChunk[] = [];

  for (const section of sections) {
    if (section.text.length <= maxChars) {
      rawChunks.push({
        text: section.text,
        chunkIndex: -1,
        chunkStart: section.start,
        chunkLength: section.text.length,
      });
    } else {
      const segments = segmentByCodeBlocks(section.text);
      for (const segment of segments) {
        if (segment.splittable) {
          const sub = splitBySentenceBoundary(
            segment.text,
            section.start + segment.start,
            maxChars,
            overlapRatio,
          );
          rawChunks.push(...sub);
        } else {
          rawChunks.push({
            text: segment.text,
            chunkIndex: -1,
            chunkStart: section.start + segment.start,
            chunkLength: segment.text.length,
          });
        }
      }
    }
  }

  for (let i = 0; i < rawChunks.length; i++) {
    rawChunks[i].chunkIndex = i;
  }

  return rawChunks;
}
