import {
  Group,
  Table,
  Text,
  ActionIcon,
  ScrollArea,
  Tooltip,
} from "@mantine/core";
import React from "react";
import { IconTrash } from "@tabler/icons-react";
import { modals } from "@mantine/modals";
import { CustomAvatar } from "@/components/ui/custom-avatar.tsx";
import {
  useChangeSpaceMemberRoleMutation,
  useRemoveSpaceMemberMutation,
  useSpaceMembersQuery,
} from "@/features/space/queries/space-query.ts";
import { IconGroupCircle } from "@/components/icons/icon-people-circle.tsx";
import { IRemoveSpaceMember } from "@/features/space/types/space.types.ts";
import RoleSelectMenu from "@/components/ui/role-select-menu.tsx";
import {
  getSpaceRoleLabel,
  spaceRoleData,
} from "@/features/space/types/space-role-data.ts";
import { formatMemberCount } from "@/lib";
import { useTranslation } from "react-i18next";
import Paginate from "@/components/common/paginate.tsx";
import { SearchInput } from "@/components/common/search-input.tsx";
import { usePaginateAndSearch } from "@/hooks/use-paginate-and-search.tsx";
import { AutoTooltipText } from "@/components/ui/auto-tooltip-text.tsx";

type MemberType = "user" | "group";

interface SpaceMembersProps {
  spaceId: string;
  readOnly?: boolean;
  headerRight?: React.ReactNode;
}

export default function SpaceMembersList({
  spaceId,
  readOnly,
  headerRight,
}: SpaceMembersProps) {
  const { t } = useTranslation();
  const { search, cursor, goNext, goPrev, handleSearch } = usePaginateAndSearch();
  const { data, isLoading } = useSpaceMembersQuery(spaceId, {
    cursor,
    limit: 100,
    query: search,
  });
  const removeSpaceMember = useRemoveSpaceMemberMutation();
  const changeSpaceMemberRoleMutation = useChangeSpaceMemberRoleMutation();

  const handleRoleChange = async (
    memberId: string,
    type: MemberType,
    newRole: string,
    currentRole: string,
  ) => {
    if (newRole === currentRole) {
      return;
    }

    const memberRoleUpdate: {
      spaceId: string;
      role: string;
      userId?: string;
      groupId?: string;
    } = {
      spaceId: spaceId,
      role: newRole,
    };

    if (type === "user") {
      memberRoleUpdate.userId = memberId;
    }
    if (type === "group") {
      memberRoleUpdate.groupId = memberId;
    }

    await changeSpaceMemberRoleMutation.mutateAsync(memberRoleUpdate);
  };

  const onRemove = async (memberId: string, type: MemberType) => {
    const memberToRemove: IRemoveSpaceMember = {
      spaceId: spaceId,
    };

    if (type === "user") {
      memberToRemove.userId = memberId;
    }
    if (type === "group") {
      memberToRemove.groupId = memberId;
    }

    await removeSpaceMember.mutateAsync(memberToRemove);
  };

  const openRemoveModal = (memberId: string, type: MemberType) =>
    modals.openConfirmModal({
      title: t("Remove space member"),
      children: (
        <Text size="sm">
          {t(
            "Are you sure you want to remove this user from the space? The user will lose all access to this space.",
          )}
        </Text>
      ),
      centered: true,
      labels: { confirm: t("Remove"), cancel: t("Cancel") },
      confirmProps: { color: "red" },
      onConfirm: () => onRemove(memberId, type),
    });

  return (
    <>
      <Group gap="sm" mb="sm" align="flex-end" wrap="nowrap">
        <div style={{ flex: 1 }}>
          <SearchInput onSearch={handleSearch} mb={0} />
        </div>
        {headerRight}
      </Group>
      <ScrollArea h={450}>
        <Table highlightOnHover verticalSpacing={8}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t("Member")}</Table.Th>
              <Table.Th>{t("Role")}</Table.Th>
              {!readOnly && <Table.Th w={50}></Table.Th>}
            </Table.Tr>
          </Table.Thead>

          <Table.Tbody>
            {data?.items.map((member, index) => (
              <Table.Tr key={index}>
                <Table.Td>
                  <Group gap="sm" wrap="nowrap">
                    {member.type === "user" && (
                      <CustomAvatar
                        avatarUrl={member?.avatarUrl}
                        name={member.name}
                      />
                    )}

                    {member.type === "group" && <IconGroupCircle />}

                    <div style={{ minWidth: 0, overflow: "hidden", maxWidth: 260 }}>
                      <AutoTooltipText fz="sm" fw={500}>
                        {member?.name}
                      </AutoTooltipText>
                      <Text fz="xs" c="dimmed">
                        {member.type == "user" && member?.email}

                        {member.type == "group" &&
                          `${t("Group")} - ${formatMemberCount(member?.memberCount, t)}`}
                      </Text>
                    </div>
                  </Group>
                </Table.Td>

                <Table.Td>
                  <RoleSelectMenu
                    roles={spaceRoleData}
                    roleName={getSpaceRoleLabel(member.role)}
                    onChange={(newRole) =>
                      handleRoleChange(
                        member.id,
                        member.type,
                        newRole,
                        member.role,
                      )
                    }
                    disabled={readOnly}
                  />
                </Table.Td>

                {!readOnly && (
                  <Table.Td>
                    <Tooltip label={t("Remove")} openDelay={300} withArrow>
                      <ActionIcon
                        variant="subtle"
                        size="sm"
                        color="red"
                        onClick={() =>
                          openRemoveModal(member.id, member.type)
                        }
                        style={{ opacity: 0.5, transition: "opacity 150ms" }}
                        onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.5"; }}
                      >
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Tooltip>
                  </Table.Td>
                )}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </ScrollArea>

      {data?.items.length > 0 && (
        <Paginate
          hasPrevPage={data?.meta?.hasPrevPage}
          hasNextPage={data?.meta?.hasNextPage}
          onNext={() => goNext(data?.meta?.nextCursor)}
          onPrev={goPrev}
        />
      )}
    </>
  );
}
