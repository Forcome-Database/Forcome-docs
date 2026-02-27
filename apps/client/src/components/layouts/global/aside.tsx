import { Box, ScrollArea, Text } from "@mantine/core";
import CommentListWithTabs from "@/features/comment/components/comment-list-with-tabs.tsx";
import { useAtom } from "jotai";
import { asideStateAtom } from "@/components/layouts/global/hooks/atoms/sidebar-atom.ts";
import React, { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { TableOfContents } from "@/features/editor/components/table-of-contents/table-of-contents.tsx";
import { useAtomValue } from "jotai";
import { pageEditorAtom } from "@/features/editor/atoms/editor-atoms.ts";
import AiCreatorPanel from "@/ee/ai/components/ai-creator/ai-creator-panel";

export default function Aside() {
  const [{ tab }] = useAtom(asideStateAtom);
  const { t } = useTranslation();
  const pageEditor = useAtomValue(pageEditorAtom);

  // AI Creator uses its own full-height layout
  if (tab === "ai-creator") {
    return (
      <Box style={{ height: "100%", display: "flex", flexDirection: "column" }}>
        <AiCreatorPanel />
      </Box>
    );
  }

  let title: string;
  let component: ReactNode;

  switch (tab) {
    case "comments":
      component = <CommentListWithTabs />;
      title = "Comments";
      break;
    case "toc":
      component = <TableOfContents editor={pageEditor} />;
      title = "Table of contents";
      break;
    default:
      component = null;
      title = null;
  }

  return (
    <Box p="md">
      {component && (
        <>
          <Text mb="md" fw={500}>
            {t(title)}
          </Text>

          {tab === "comments" ? (
            <CommentListWithTabs />
          ) : (
            <ScrollArea
              style={{ height: "85vh" }}
              scrollbarSize={5}
              type="scroll"
            >
              <div style={{ paddingBottom: "200px" }}>{component}</div>
            </ScrollArea>
          )}
        </>
      )}
    </Box>
  );
}
