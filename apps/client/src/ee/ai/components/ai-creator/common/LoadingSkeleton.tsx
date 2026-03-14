import { Skeleton, Stack, Group } from '@mantine/core';

interface LoadingSkeletonProps {
  type: 'brief' | 'blueprint' | 'review' | 'draft';
}

export function LoadingSkeleton({ type }: LoadingSkeletonProps) {
  if (type === 'brief') {
    return (
      <Stack gap="sm" p="md">
        <Skeleton height={20} width="40%" />
        <Skeleton height={32} />
        <Skeleton height={32} />
        <Skeleton height={32} />
        <Skeleton height={32} />
        <Group>
          <Skeleton height={32} width="48%" />
          <Skeleton height={32} width="48%" />
        </Group>
      </Stack>
    );
  }

  if (type === 'blueprint') {
    return (
      <Stack gap="sm" p="md">
        <Skeleton height={24} width="60%" />
        {Array.from({ length: 4 }).map((_, i) => (
          <Stack key={i} gap={4}>
            <Skeleton height={16} width="80%" />
            <Skeleton height={12} width="30%" />
          </Stack>
        ))}
      </Stack>
    );
  }

  if (type === 'review') {
    return (
      <Stack gap="sm" p="md">
        <Group>
          <Skeleton circle height={80} />
          <Stack gap="xs" flex={1}>
            <Skeleton height={16} width="60%" />
            <Skeleton height={16} width="40%" />
          </Stack>
        </Group>
        <Skeleton height={40} />
        <Skeleton height={40} />
      </Stack>
    );
  }

  // draft
  return (
    <Stack gap="xs" p="md">
      <Skeleton height={8} />
      <Skeleton height={100} />
      <Skeleton height={8} width="60%" />
    </Stack>
  );
}
