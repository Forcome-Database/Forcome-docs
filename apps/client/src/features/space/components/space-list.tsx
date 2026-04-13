import { ActionIcon, Group, Table, Text, Tooltip } from "@mantine/core";
import React, { useCallback, useMemo, useState } from "react";
import { useGetSpacesQuery } from "@/features/space/queries/space-query.ts";
import SpaceSettingsModal from "@/features/space/components/settings-modal.tsx";
import { useDisclosure } from "@mantine/hooks";
import { formatMemberCount } from "@/lib";
import { useTranslation } from "react-i18next";
import { CustomAvatar } from "@/components/ui/custom-avatar.tsx";
import { AvatarIconType } from "@/features/attachments/types/attachment.types.ts";
import { AutoTooltipText } from "@/components/ui/auto-tooltip-text.tsx";
import { ISpace } from "@/features/space/types/space.types.ts";
import { updateSpace } from "@/features/space/services/space-service.ts";
import { IconGripVertical } from "@tabler/icons-react";
import useUserRole from "@/hooks/use-user-role.tsx";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  generateJitteredKeyBetween,
} from "fractional-indexing-jittered";
import { useQueryClient } from "@tanstack/react-query";

interface SortableRowProps {
  space: ISpace;
  canDrag: boolean;
  onClick: (spaceId: string) => void;
  t: any;
}

function SortableRow({ space, canDrag, onClick, t }: SortableRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: space.id, disabled: !canDrag });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    cursor: "pointer",
  };

  return (
    <Table.Tr
      ref={setNodeRef}
      style={style}
      onClick={() => onClick(space.id)}
    >
      {canDrag && (
        <Table.Td w={36} style={{ padding: "0 4px" }}>
          <Tooltip label={t("Drag to reorder")} position="left" openDelay={400}>
            <ActionIcon
              variant="subtle"
              color="gray"
              size="sm"
              style={{ cursor: "grab", touchAction: "none" }}
              {...attributes}
              {...listeners}
              onClick={(e) => e.stopPropagation()}
            >
              <IconGripVertical size={16} />
            </ActionIcon>
          </Tooltip>
        </Table.Td>
      )}
      <Table.Td>
        <Group gap="sm" wrap="nowrap">
          <CustomAvatar
            color="initials"
            avatarUrl={space.logo}
            type={AvatarIconType.SPACE_ICON}
            variant="filled"
            name={space.name}
          />
          <div style={{ minWidth: 0, overflow: "hidden" }}>
            <AutoTooltipText fz="sm" fw={500} lineClamp={1}>
              {space.name}
            </AutoTooltipText>
            <Text fz="xs" c="dimmed" lineClamp={2}>
              {space.description}
            </Text>
          </div>
        </Group>
      </Table.Td>
      <Table.Td>
        <Text size="sm" style={{ whiteSpace: "nowrap" }}>
          {formatMemberCount(space.memberCount, t)}
        </Text>
      </Table.Td>
    </Table.Tr>
  );
}

function DragOverlayRow({ space, t }: { space: ISpace; t: any }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <tbody>
        <tr
          style={{
            background: "var(--mantine-color-body)",
            boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
            borderRadius: 8,
            display: "table-row",
          }}
        >
          <td style={{ padding: "0 4px", width: 36 }}>
            <ActionIcon variant="subtle" color="gray" size="sm" style={{ cursor: "grabbing" }}>
              <IconGripVertical size={16} />
            </ActionIcon>
          </td>
          <td style={{ padding: "12px 8px" }}>
            <Group gap="sm" wrap="nowrap">
              <CustomAvatar
                color="initials"
                avatarUrl={space.logo}
                type={AvatarIconType.SPACE_ICON}
                variant="filled"
                name={space.name}
              />
              <Text fz="sm" fw={500}>
                {space.name}
              </Text>
            </Group>
          </td>
          <td style={{ padding: "12px 8px" }}>
            <Text size="sm">{formatMemberCount(space.memberCount, t)}</Text>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

export default function SpaceList() {
  const { t } = useTranslation();
  const { isAdmin } = useUserRole();
  const { data } = useGetSpacesQuery();
  const [opened, { open, close }] = useDisclosure(false);
  const [selectedSpaceId, setSelectedSpaceId] = useState<string>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [localItems, setLocalItems] = useState<ISpace[] | null>(null);
  const queryClient = useQueryClient();

  const items = localItems ?? data?.items ?? [];
  const itemIds = useMemo(() => items.map((s) => s.id), [items]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleClick = (spaceId: string) => {
    if (activeId) return;
    setSelectedSpaceId(spaceId);
    open();
  };

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string);
    setLocalItems(data?.items ?? []);
  }, [data?.items]);

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveId(null);

      if (!over || active.id === over.id || !localItems) {
        setLocalItems(null);
        return;
      }

      const oldIndex = localItems.findIndex((s) => s.id === active.id);
      const newIndex = localItems.findIndex((s) => s.id === over.id);
      if (oldIndex === -1 || newIndex === -1) {
        setLocalItems(null);
        return;
      }

      const reordered = arrayMove(localItems, oldIndex, newIndex);
      setLocalItems(reordered);

      // Calculate new position using fractional indexing
      const beforePos = newIndex > 0 ? (reordered[newIndex - 1].position ?? null) : null;
      const afterPos =
        newIndex < reordered.length - 1
          ? (reordered[newIndex + 1].position ?? null)
          : null;
      const newPosition = generateJitteredKeyBetween(beforePos, afterPos);

      // Optimistic update
      reordered[newIndex] = { ...reordered[newIndex], position: newPosition };
      setLocalItems(reordered);

      try {
        await updateSpace({
          spaceId: active.id as string,
          position: newPosition,
        });
        queryClient.invalidateQueries({ queryKey: ["spaces"] });
      } catch {
        // Revert on failure
        setLocalItems(null);
      }
    },
    [localItems, queryClient],
  );

  const handleDragCancel = useCallback(() => {
    setActiveId(null);
    setLocalItems(null);
  }, []);

  const activeSpace = activeId
    ? items.find((s) => s.id === activeId)
    : null;

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <Table.ScrollContainer minWidth={500}>
          <Table highlightOnHover verticalSpacing="sm" layout="fixed">
            <Table.Thead>
              <Table.Tr>
                {isAdmin && <Table.Th w={36}></Table.Th>}
                <Table.Th>{t("Space")}</Table.Th>
                <Table.Th>{t("Members")}</Table.Th>
              </Table.Tr>
            </Table.Thead>

            <Table.Tbody>
              <SortableContext
                items={itemIds}
                strategy={verticalListSortingStrategy}
              >
                {items.map((space) => (
                  <SortableRow
                    key={space.id}
                    space={space}
                    canDrag={isAdmin}
                    onClick={handleClick}
                    t={t}
                  />
                ))}
              </SortableContext>
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>

        <DragOverlay dropAnimation={null}>
          {activeSpace ? (
            <DragOverlayRow space={activeSpace} t={t} />
          ) : null}
        </DragOverlay>
      </DndContext>

      {selectedSpaceId && (
        <SpaceSettingsModal
          opened={opened}
          onClose={close}
          spaceId={selectedSpaceId}
        />
      )}
    </>
  );
}
