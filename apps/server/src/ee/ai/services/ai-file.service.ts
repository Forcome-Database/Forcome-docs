import { Injectable, Logger } from '@nestjs/common';

export interface AiContentPart {
  type: 'text' | 'image';
  text?: string;
  data?: string; // base64
  mimeType?: string;
}

export interface BufferedFile {
  buffer: Buffer;
  mimetype: string;
  filename: string;
}

@Injectable()
export class AiFileService {
  private readonly logger = new Logger(AiFileService.name);

  async processBufferedFiles(files: BufferedFile[]): Promise<AiContentPart[]> {
    const parts: AiContentPart[] = [];

    for (const file of files) {
      const { buffer, mimetype: mime, filename } = file;

      if (mime === 'application/pdf') {
        // Extract text from PDF - compatible with all AI providers
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const pdfParse = require('pdf-parse');
        const pdfData = await pdfParse(buffer);
        const text = pdfData.text?.trim() || '';
        parts.push({
          type: 'text',
          text: `[Document: ${filename}]\n\n${text}`,
        });
        this.logger.debug(
          `Processed PDF: ${filename}, extracted ${text.length} chars`,
        );
      } else if (mime.startsWith('image/')) {
        const base64 = buffer.toString('base64');
        parts.push({ type: 'image', data: base64, mimeType: mime });
        this.logger.debug(
          `Processed image: ${filename}, size=${buffer.length}`,
        );
      } else if (
        mime ===
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      ) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const mammoth = require('mammoth');
        const result = await mammoth.convertToHtml({ buffer });
        const text = result.value
          .replace(/<\/?(p|div|br|h[1-6])[^>]*>/gi, '\n')
          .replace(/<li[^>]*>/gi, '\n- ')
          .replace(/<[^>]+>/g, '')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
        parts.push({
          type: 'text',
          text: `[Document: ${filename}]\n\n${text}`,
        });
        this.logger.debug(
          `Processed Word: ${filename}, extracted ${text.length} chars`,
        );
      } else {
        this.logger.warn(`Unsupported file type: ${mime}, skipping`);
      }
    }

    return parts;
  }
}
