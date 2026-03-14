import { Modal, Text } from '@mantine/core';

interface BlueprintModalProps {
  opened: boolean;
  onClose: () => void;
}

export function BlueprintModal({ opened, onClose }: BlueprintModalProps) {
  return (
    <Modal opened={opened} onClose={onClose} size="xl" title="Creation Blueprint">
      <Text c="dimmed" size="sm">
        Blueprint Editor — Phase 2 implementation pending
      </Text>
    </Modal>
  );
}
