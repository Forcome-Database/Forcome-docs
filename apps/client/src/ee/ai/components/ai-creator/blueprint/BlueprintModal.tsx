import React from 'react';
import {
  Modal,
  Text,
  Stack,
  Group,
  Button,
  Paper,
  Badge,
  TextInput,
  NumberInput,
  Grid,
  ScrollArea,
  Divider,
  ActionIcon,
} from '@mantine/core';
import { useEffect, useState } from 'react';
import { IconGripVertical, IconTrash } from '@tabler/icons-react';
import type { CreationBlueprint, SectionPlan, VisualPlan } from '../../../types/blueprint.types';
import { SourceImageCandidates } from './SourceImageCandidates';

interface BlueprintModalProps {
  opened: boolean;
  onClose: () => void;
  blueprint: CreationBlueprint;
  onConfirm: (blueprint: CreationBlueprint) => void;
  onRegenerate?: () => void;
  withinPortal?: boolean;
}

function getSelectedSourceImageId(section: SectionPlan): string | null {
  return section.visuals.find((visual) => visual.type === 'reuse_image')?.source_asset_id ?? null;
}

export function applySectionSourceImageSelection(section: SectionPlan, candidateId: string | null): SectionPlan {
  const nextImageVisual: VisualPlan = candidateId
    ? {
        type: 'reuse_image',
        description: `Reuse source image ${candidateId}`,
        source_asset_id: candidateId,
        position: 'before_section',
      }
    : {
        type: 'ai_image',
        description: 'Generate a new illustration for this section',
        source_asset_id: null,
        position: 'before_section',
      };

  const visuals = [...section.visuals];
  const imageVisualIndex = visuals.findIndex(
    (visual) => visual.type === 'reuse_image' || visual.type === 'ai_image',
  );

  if (imageVisualIndex >= 0) {
    visuals[imageVisualIndex] = nextImageVisual;
  } else {
    visuals.push(nextImageVisual);
  }

  return { ...section, visuals };
}

export function BlueprintModal({
  opened,
  onClose,
  blueprint,
  onConfirm,
  onRegenerate,
  withinPortal = true,
}: BlueprintModalProps) {
  const [localBlueprint, setLocalBlueprint] = useState<CreationBlueprint>(blueprint);

  useEffect(() => {
    setLocalBlueprint(blueprint);
  }, [blueprint, opened]);

  const totalWords = localBlueprint.sections.reduce((sum, s) => sum + s.word_budget, 0);

  const updateSection = (index: number, updates: Partial<SectionPlan>) => {
    const newSections = [...localBlueprint.sections];
    newSections[index] = { ...newSections[index], ...updates };
    setLocalBlueprint({ ...localBlueprint, sections: newSections });
  };

  const removeSection = (index: number) => {
    const newSections = localBlueprint.sections.filter((_, i) => i !== index);
    setLocalBlueprint({ ...localBlueprint, sections: newSections });
  };

  const moveSection = (from: number, to: number) => {
    const newSections = [...localBlueprint.sections];
    const [moved] = newSections.splice(from, 1);
    newSections.splice(to, 0, moved);
    setLocalBlueprint({ ...localBlueprint, sections: newSections });
  };

  const visualTypeLabel = (type: VisualPlan['type']) => {
    switch (type) {
      case 'mermaid': return '📊 流程图';
      case 'ai_image': return '🎨 AI 图';
      case 'reuse_image': return '📷 复用图';
      case 'table': return '📋 表格';
      default: return type;
    }
  };

  const outlinePreview = localBlueprint.sections
    .map((s) => `${'#'.repeat(s.level)} ${s.title}\n${s.description || ''}`)
    .join('\n\n');

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      size="xl"
      title="📋 创作蓝图"
      withinPortal={withinPortal}
      styles={{ body: { padding: 0 } }}
    >
      <Grid gutter={0} style={{ minHeight: '60vh' }}>
        {/* Left: Section Editor */}
        <Grid.Col span={7} style={{ borderRight: '1px solid var(--mantine-color-gray-3)' }}>
          <ScrollArea h="55vh" p="md">
            <Stack gap="sm">
              {localBlueprint.sections.map((section, idx) => (
                <Paper key={section.id} withBorder p="sm" radius="sm">
                  <Group justify="space-between" mb="xs">
                    <Group gap="xs">
                      <ActionIcon size="sm" variant="subtle" c="dimmed">
                        <IconGripVertical size={14} />
                      </ActionIcon>
                      <Badge size="xs" variant="light">H{section.level}</Badge>
                    </Group>
                    <Group gap="xs">
                      {idx > 0 && (
                        <ActionIcon size="xs" variant="subtle" onClick={() => moveSection(idx, idx - 1)}>
                          ↑
                        </ActionIcon>
                      )}
                      {idx < localBlueprint.sections.length - 1 && (
                        <ActionIcon size="xs" variant="subtle" onClick={() => moveSection(idx, idx + 1)}>
                          ↓
                        </ActionIcon>
                      )}
                      <ActionIcon size="xs" variant="subtle" color="red" onClick={() => removeSection(idx)}>
                        <IconTrash size={12} />
                      </ActionIcon>
                    </Group>
                  </Group>

                  <TextInput
                    size="xs"
                    value={section.title}
                    onChange={(e) => updateSection(idx, { title: e.target.value })}
                    mb="xs"
                  />

                  <Group gap="xs">
                    <NumberInput
                      size="xs"
                      label="字数"
                      value={section.word_budget}
                      onChange={(v) => updateSection(idx, { word_budget: typeof v === 'number' ? v : 0 })}
                      min={50}
                      step={100}
                      style={{ width: 100 }}
                    />
                    {section.visuals.length > 0 && (
                      <Group gap={4} mt="auto">
                        {section.visuals.map((v, vi) => (
                          <Badge key={vi} size="xs" variant="dot">{visualTypeLabel(v.type)}</Badge>
                        ))}
                      </Group>
                    )}
                  </Group>
                  <SourceImageCandidates
                    candidates={section.visual_candidates ?? []}
                    selectedCandidateId={getSelectedSourceImageId(section)}
                    onSelect={(candidateId) =>
                      updateSection(idx, applySectionSourceImageSelection(section, candidateId))
                    }
                    onPreferGenerated={() =>
                      updateSection(idx, applySectionSourceImageSelection(section, null))
                    }
                  />
                </Paper>
              ))}
            </Stack>
          </ScrollArea>
        </Grid.Col>

        {/* Right: Preview */}
        <Grid.Col span={5}>
          <Stack p="md" h="55vh">
            <Text size="sm" fw={600}>大纲预览</Text>
            <ScrollArea flex={1}>
              <Text size="xs" style={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace' }} c="dimmed">
                {outlinePreview}
              </Text>
            </ScrollArea>
          </Stack>
        </Grid.Col>
      </Grid>

      <Divider />
      <Group p="md" justify="space-between">
        <Text size="sm" c="dimmed">
          总计：{totalWords} 字 / {localBlueprint.sections.length} 章
          {localBlueprint.total_word_budget > 0 && ` (目标 ${localBlueprint.total_word_budget} 字)`}
        </Text>
        <Group>
          {onRegenerate && (
            <Button size="sm" variant="subtle" onClick={onRegenerate}>重新生成</Button>
          )}
          <Button size="sm" onClick={() => onConfirm(localBlueprint)}>确认开始写作</Button>
        </Group>
      </Group>
    </Modal>
  );
}
