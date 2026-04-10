import { Modal, Tabs, rem, ScrollArea, Text } from "@mantine/core";
import SpaceMembersList from "@/features/space/components/space-members.tsx";
import AddSpaceMembersModal from "@/features/space/components/add-space-members-modal.tsx";
import React from "react";
import SpaceDetails from "@/features/space/components/space-details.tsx";
import { useSpaceQuery } from "@/features/space/queries/space-query.ts";
import { useSpaceAbility } from "@/features/space/permissions/use-space-ability.ts";
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from "@/features/space/permissions/permissions.type.ts";
import { useTranslation } from "react-i18next";
import { DirectoryList } from "@/features/directory/components/directory-list";
import { TopicList } from "@/features/topic/components/topic-list";

interface SpaceSettingsModalProps {
  spaceId: string;
  opened: boolean;
  onClose: () => void;
}

export default function SpaceSettingsModal({
  spaceId,
  opened,
  onClose,
}: SpaceSettingsModalProps) {
  const { t } = useTranslation();
  const { data: space, isLoading } = useSpaceQuery(spaceId);

  const spaceRules = space?.membership?.permissions;
  const spaceAbility = useSpaceAbility(spaceRules);

  const panelStyle: React.CSSProperties = { paddingTop: 16, paddingBottom: 60 };

  return (
    <Modal.Root
      opened={opened}
      onClose={onClose}
      size={620}
      padding="xl"
      yOffset="8vh"
      xOffset={0}
    >
      <Modal.Overlay />
      <Modal.Content style={{ overflow: "hidden" }}>
        <Modal.Header py={0}>
          <Modal.Title>
            <Text fw={500} lineClamp={1}>
              {space?.name}
            </Text>
          </Modal.Title>
          <Modal.CloseButton />
        </Modal.Header>
        <Modal.Body>
          <div style={{ height: rem(560) }}>
            <Tabs defaultValue="members">
              <Tabs.List>
                <Tabs.Tab fw={500} value="general">
                  {t("Settings")}
                </Tabs.Tab>
                <Tabs.Tab fw={500} value="members">
                  {t("Members")}
                </Tabs.Tab>
                <Tabs.Tab fw={500} value="directories">
                  {t("Directories")}
                </Tabs.Tab>
                <Tabs.Tab fw={500} value="topics">
                  {t("Topics")}
                </Tabs.Tab>
              </Tabs.List>

              <Tabs.Panel value="general">
                <ScrollArea h={530} scrollbarSize={5} pr={8}>
                  <div style={panelStyle}>
                    <SpaceDetails
                      spaceId={space?.id}
                      readOnly={spaceAbility.cannot(
                        SpaceCaslAction.Manage,
                        SpaceCaslSubject.Settings,
                      )}
                    />
                  </div>
                </ScrollArea>
              </Tabs.Panel>

              <Tabs.Panel value="members">
                <div style={panelStyle}>
                  <SpaceMembersList
                    spaceId={space?.id}
                    readOnly={spaceAbility.cannot(
                      SpaceCaslAction.Manage,
                      SpaceCaslSubject.Member,
                    )}
                    headerRight={
                      spaceAbility.can(
                        SpaceCaslAction.Manage,
                        SpaceCaslSubject.Member,
                      ) ? <AddSpaceMembersModal spaceId={space?.id} /> : undefined
                    }
                  />
                </div>
              </Tabs.Panel>

              <Tabs.Panel value="directories">
                <ScrollArea h={530} scrollbarSize={5} pr={8}>
                  <div style={panelStyle}>
                    <DirectoryList
                      spaceId={space?.id}
                      readOnly={spaceAbility.cannot(
                        SpaceCaslAction.Manage,
                        SpaceCaslSubject.Settings,
                      )}
                    />
                  </div>
                </ScrollArea>
              </Tabs.Panel>

              <Tabs.Panel value="topics">
                <ScrollArea h={530} scrollbarSize={5} pr={8}>
                  <div style={panelStyle}>
                    <TopicList
                      spaceId={space?.id}
                      readOnly={spaceAbility.cannot(
                        SpaceCaslAction.Manage,
                        SpaceCaslSubject.Settings,
                      )}
                    />
                  </div>
                </ScrollArea>
              </Tabs.Panel>
            </Tabs>
          </div>
        </Modal.Body>
      </Modal.Content>
    </Modal.Root>
  );
}
