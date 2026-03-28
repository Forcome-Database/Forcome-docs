import sharp from 'sharp';
import { StorageService } from '../../integrations/storage/storage.service';

/**
 * 页面内容宽度参考值（px）。
 * TipTap 编辑器实际渲染宽度约 720px。
 */
const PAGE_CONTENT_WIDTH = 720;

export interface ImageDimensionAttachment {
  id: string;
  fileName: string;
  filePath: string;
}

/**
 * 遍历 ProseMirror JSON 中的 image 节点，
 * 根据附件实际像素尺寸自动设置 width 和 aspectRatio。
 *
 * 策略:
 *  - 窄图（< 50% 页宽，如手机截图）→ 50%
 *  - 中等图（50%-100% 页宽）→ 按实际比例
 *  - 宽图（> 页宽）→ 100%
 */
export async function setAiImageDimensions(
  prosemirrorJson: any,
  attachments: ImageDimensionAttachment[],
  storageService: StorageService,
): Promise<{ document: any; updatedCount: number }> {
  if (!prosemirrorJson || !attachments.length) {
    return { document: prosemirrorJson, updatedCount: 0 };
  }

  // 批量获取尺寸（并行，快速）
  const dimensionCache = new Map<string, { width: number; height: number }>();
  await Promise.all(
    attachments.map(async (att) => {
      try {
        const buffer = await storageService.read(att.filePath);
        const metadata = await sharp(buffer).metadata();
        if (metadata.width && metadata.height) {
          dimensionCache.set(att.id, {
            width: metadata.width,
            height: metadata.height,
          });
        }
      } catch {
        // 无法读取尺寸，跳过
      }
    }),
  );

  let updatedCount = 0;

  const visit = (node: any) => {
    if (!node || typeof node !== 'object') return;

    if (node.type === 'image' && node.attrs?.attachmentId) {
      const dims = dimensionCache.get(node.attrs.attachmentId);
      if (dims) {
        // 设置 aspectRatio
        if (!node.attrs.aspectRatio) {
          node.attrs.aspectRatio = dims.width / dims.height;
        }

        // 智能宽度：仅对默认 100% 的图片调整
        if (!node.attrs.width || node.attrs.width === '100%') {
          if (dims.width < PAGE_CONTENT_WIDTH * 0.5) {
            node.attrs.width = '50%';
          } else if (dims.width < PAGE_CONTENT_WIDTH) {
            const pct = Math.round((dims.width / PAGE_CONTENT_WIDTH) * 100);
            node.attrs.width = `${Math.min(pct, 100)}%`;
          }
          // 宽图保持 100%
        }

        updatedCount++;
      }
    }

    if (Array.isArray(node.content)) {
      for (const child of node.content) {
        visit(child);
      }
    }
  };

  visit(prosemirrorJson);
  return { document: prosemirrorJson, updatedCount };
}
