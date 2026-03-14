import { Modal, Text } from '@mantine/core';

interface ReviewModalProps {
  opened: boolean;
  onClose: () => void;
}

export function ReviewModal({ opened, onClose }: ReviewModalProps) {
  return (
    <Modal opened={opened} onClose={onClose} size="xl" title="质量评审报告">
      <Text c="dimmed" size="sm">
        Review Card — Phase 4 implementation pending
      </Text>
    </Modal>
  );
}
