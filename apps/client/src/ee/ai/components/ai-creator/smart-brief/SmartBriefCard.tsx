import React from 'react';
import { Badge, Button, Card, Divider, Group, NumberInput, Select, Stack, Text } from '@mantine/core';
import { useEffect, useState } from 'react';
import type { AgentAssetSummary } from '../../../types/agent.types';
import type { CreationBrief } from '../../../types/brief.types';
import { imageStrategyLabel, normalizeImageStrategy } from '../../../types/source-assets.types';

interface SmartBriefCardProps {
  brief: CreationBrief;
  assetSummary?: AgentAssetSummary;
  onConfirm: (brief: CreationBrief) => void;
  onEdit?: () => void;
}

export function SmartBriefCard({ brief, assetSummary, onConfirm, onEdit }: SmartBriefCardProps) {
  const [localBrief, setLocalBrief] = useState<CreationBrief>({
    ...brief,
    image_strategy: normalizeImageStrategy(brief.image_strategy),
  });

  useEffect(() => {
    setLocalBrief({
      ...brief,
      image_strategy: normalizeImageStrategy(brief.image_strategy),
    });
  }, [brief]);

  const dedup = (options: Array<{ value: string; label: string }>) => {
    const seen = new Set<string>();
    return options.filter((option) => {
      if (seen.has(option.value)) {
        return false;
      }
      seen.add(option.value);
      return true;
    });
  };

  const audienceOptions = dedup([
    { value: brief.audience || 'General audience', label: brief.audience || 'General audience' },
    { value: 'Engineering', label: 'Engineering' },
    { value: 'Management', label: 'Management' },
    { value: 'Product team', label: 'Product team' },
    { value: 'Customers', label: 'Customers' },
  ]);

  const styleOptions = dedup([
    { value: brief.style || 'Professional', label: brief.style || 'Professional' },
    { value: 'Professional', label: 'Professional' },
    { value: 'Friendly', label: 'Friendly' },
    { value: 'Academic', label: 'Academic' },
    { value: 'Business formal', label: 'Business formal' },
  ]);

  const structureOptions = [
    { value: 'copy_source', label: 'Follow source structure' },
    { value: 'ai_recommend', label: 'AI recommended' },
    { value: 'user_defined', label: 'User defined' },
  ];

  const imageOptions = [
    { value: 'reuse_source_only', label: imageStrategyLabel('reuse_source_only') },
    { value: 'prefer_source_then_generate', label: imageStrategyLabel('prefer_source_then_generate') },
    { value: 'generate_new_only', label: imageStrategyLabel('generate_new_only') },
    { value: 'none', label: imageStrategyLabel('none') },
  ];

  const handleConfirm = () =>
    onConfirm({
      ...localBrief,
      image_strategy: normalizeImageStrategy(localBrief.image_strategy),
    });

  return (
    <Card withBorder p="md" radius="md">
      <Stack gap="sm">
        <Group justify="space-between">
          <Text fw={600} size="sm">Smart Brief</Text>
          <Badge variant="light" size="xs" color="blue">AI recommended</Badge>
        </Group>

        <Select
          label="Audience"
          size="xs"
          data={audienceOptions}
          value={localBrief.audience || audienceOptions[0]?.value}
          onChange={(value) => value && setLocalBrief({ ...localBrief, audience: value })}
          searchable
        />

        <NumberInput
          label="Target length"
          size="xs"
          value={localBrief.target_length}
          onChange={(value) => setLocalBrief({ ...localBrief, target_length: typeof value === 'number' ? value : 0 })}
          min={100}
          step={500}
        />

        <Select
          label="Style"
          size="xs"
          data={styleOptions}
          value={localBrief.style || styleOptions[0]?.value}
          onChange={(value) => value && setLocalBrief({ ...localBrief, style: value })}
          searchable
        />

        <Select
          label="Structure strategy"
          size="xs"
          data={structureOptions}
          value={localBrief.structure_strategy}
          onChange={(value) =>
            value && setLocalBrief({ ...localBrief, structure_strategy: value as CreationBrief['structure_strategy'] })
          }
        />

        <Select
          label="Image strategy"
          size="xs"
          data={imageOptions}
          value={normalizeImageStrategy(localBrief.image_strategy)}
          onChange={(value) =>
            value && setLocalBrief({ ...localBrief, image_strategy: value as CreationBrief['image_strategy'] })
          }
        />

        {assetSummary && (
          <>
            <Divider />
            <Text size="xs" c="dimmed" fw={500}>Detected assets</Text>
            <Group gap="xs">
              {assetSummary.images > 0 && <Badge size="xs" variant="outline">{assetSummary.images} images</Badge>}
              {assetSummary.tables > 0 && <Badge size="xs" variant="outline">{assetSummary.tables} tables</Badge>}
              {assetSummary.code > 0 && <Badge size="xs" variant="outline">{assetSummary.code} code blocks</Badge>}
              {assetSummary.text > 0 && <Badge size="xs" variant="outline">{assetSummary.text} text sections</Badge>}
            </Group>
          </>
        )}

        <Group mt="xs">
          <Button size="xs" onClick={handleConfirm} flex={1}>Confirm and continue</Button>
          {onEdit && (
            <Button size="xs" variant="subtle" onClick={onEdit}>Edit details</Button>
          )}
        </Group>
      </Stack>
    </Card>
  );
}
