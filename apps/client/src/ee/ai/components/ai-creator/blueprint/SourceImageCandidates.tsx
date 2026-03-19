import React from 'react';
import { Badge, Button, Card, Group, Stack, Text } from '@mantine/core';
import type { SourceImageCandidate } from '../../../types/source-assets.types';

interface SourceImageCandidatesProps {
  candidates: SourceImageCandidate[];
  selectedCandidateId?: string | null;
  onSelect: (candidateId: string) => void;
  onPreferGenerated?: () => void;
}

export function SourceImageCandidates({
  candidates,
  selectedCandidateId,
  onSelect,
  onPreferGenerated,
}: SourceImageCandidatesProps) {
  if (candidates.length === 0) {
    return null;
  }

  return (
    <Stack gap="xs" mt="xs">
      <Text size="xs" fw={500}>Source image candidates</Text>
      {candidates.map((candidate) => {
        const selected = candidate.asset_id === selectedCandidateId;
        return (
          <Card key={candidate.asset_id} withBorder padding="xs" radius="sm">
            <Stack gap={4}>
              <Group justify="space-between" align="flex-start">
                <Stack gap={2}>
                  <Text size="xs" fw={500}>{candidate.caption || candidate.asset_id}</Text>
                  <Text size="xs" c="dimmed">
                    {candidate.source}
                    {candidate.source_page ? ` · p.${candidate.source_page}` : ""}
                    {candidate.source_heading ? ` · ${candidate.source_heading}` : ""}
                  </Text>
                </Stack>
                <Badge size="xs" variant={selected ? 'filled' : 'light'}>
                  {selected ? 'Selected' : `Score ${candidate.score.toFixed(1)}`}
                </Badge>
              </Group>
              {candidate.rationale && (
                <Text size="xs" c="dimmed">
                  {candidate.rationale}
                </Text>
              )}
              <Group justify="space-between">
                <Text size="xs" ff="monospace">{candidate.asset_id}</Text>
                <Button size="compact-xs" variant={selected ? 'light' : 'subtle'} onClick={() => onSelect(candidate.asset_id)}>
                  {selected ? 'Using this image' : 'Use this image'}
                </Button>
              </Group>
            </Stack>
          </Card>
        );
      })}
      {onPreferGenerated && (
        <Button size="compact-xs" variant="subtle" onClick={onPreferGenerated}>
          Prefer generated image instead
        </Button>
      )}
    </Stack>
  );
}
