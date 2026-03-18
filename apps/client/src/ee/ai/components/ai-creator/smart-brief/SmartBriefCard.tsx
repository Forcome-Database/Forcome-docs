import { Card, Text, Stack, Select, NumberInput, Button, Group, Badge, Divider } from '@mantine/core';
import { useState } from 'react';
import type { CreationBrief } from '../../../types/brief.types';
import type { AgentAssetSummary } from '../../../types/agent.types';

interface SmartBriefCardProps {
  brief: CreationBrief;
  assetSummary?: AgentAssetSummary;
  onConfirm: (brief: CreationBrief) => void;
  onEdit?: () => void;
}

export function SmartBriefCard({ brief, assetSummary, onConfirm, onEdit }: SmartBriefCardProps) {
  const [localBrief, setLocalBrief] = useState<CreationBrief>(brief);

  // Mantine v8 Select does not support creatable — use a fixed list that includes
  // the AI-recommended value so it appears pre-selected.
  const dedup = (opts: { value: string; label: string }[]) => {
    const seen = new Set<string>();
    return opts.filter((o) => { if (seen.has(o.value)) return false; seen.add(o.value); return true; });
  };

  const audienceOptions = dedup([
    { value: brief.audience || '通用读者', label: brief.audience || '通用读者' },
    { value: '技术团队', label: '技术团队' },
    { value: '管理层', label: '管理层' },
    { value: '产品团队', label: '产品团队' },
    { value: '客户/用户', label: '客户/用户' },
  ]);

  const styleOptions = dedup([
    { value: brief.style || '专业严谨', label: brief.style || '专业严谨' },
    { value: '专业严谨', label: '专业严谨' },
    { value: '轻松友好', label: '轻松友好' },
    { value: '学术规范', label: '学术规范' },
    { value: '商务正式', label: '商务正式' },
  ]);

  const structureOptions = [
    { value: 'copy_source', label: '复制原文结构' },
    { value: 'ai_recommend', label: 'AI 推荐' },
    { value: 'user_defined', label: '自定义' },
  ];

  const imageOptions = [
    { value: 'reuse_source', label: '复用素材图片' },
    { value: 'generate_new', label: 'AI 生成新图' },
    { value: 'mixed', label: '混合' },
    { value: 'none', label: '无需配图' },
  ];

  const handleConfirm = () => onConfirm(localBrief);

  return (
    <Card withBorder p="md" radius="md">
      <Stack gap="sm">
        <Group justify="space-between">
          <Text fw={600} size="sm">📝 创作简报</Text>
          <Badge variant="light" size="xs" color="blue">AI 推荐</Badge>
        </Group>

        <Select
          label="目标读者"
          size="xs"
          data={audienceOptions}
          value={localBrief.audience || audienceOptions[0]?.value}
          onChange={(v) => v && setLocalBrief({ ...localBrief, audience: v })}
          searchable
        />

        <NumberInput
          label="目标篇幅（字）"
          size="xs"
          value={localBrief.target_length}
          onChange={(v) => setLocalBrief({ ...localBrief, target_length: typeof v === 'number' ? v : 0 })}
          min={100}
          step={500}
        />

        <Select
          label="写作风格"
          size="xs"
          data={styleOptions}
          value={localBrief.style || styleOptions[0]?.value}
          onChange={(v) => v && setLocalBrief({ ...localBrief, style: v })}
          searchable
        />

        <Select
          label="结构策略"
          size="xs"
          data={structureOptions}
          value={localBrief.structure_strategy}
          onChange={(v) =>
            v && setLocalBrief({ ...localBrief, structure_strategy: v as CreationBrief['structure_strategy'] })
          }
        />

        <Select
          label="配图策略"
          size="xs"
          data={imageOptions}
          value={localBrief.image_strategy}
          onChange={(v) =>
            v && setLocalBrief({ ...localBrief, image_strategy: v as CreationBrief['image_strategy'] })
          }
        />

        {assetSummary && (
          <>
            <Divider />
            <Text size="xs" c="dimmed" fw={500}>📎 发现的素材</Text>
            <Group gap="xs">
              {assetSummary.images > 0 && <Badge size="xs" variant="outline">{assetSummary.images} 张图片</Badge>}
              {assetSummary.tables > 0 && <Badge size="xs" variant="outline">{assetSummary.tables} 个表格</Badge>}
              {assetSummary.code > 0 && <Badge size="xs" variant="outline">{assetSummary.code} 段代码</Badge>}
              {assetSummary.text > 0 && <Badge size="xs" variant="outline">{assetSummary.text} 个章节</Badge>}
            </Group>
          </>
        )}

        <Group mt="xs">
          <Button size="xs" onClick={handleConfirm} flex={1}>确认开始</Button>
          {onEdit && (
            <Button size="xs" variant="subtle" onClick={onEdit}>修改详情</Button>
          )}
        </Group>
      </Stack>
    </Card>
  );
}
