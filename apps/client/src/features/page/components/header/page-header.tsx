import classes from "./page-header.module.css";
import PageHeaderMenu from "@/features/page/components/header/page-header-menu.tsx";
import { Group } from "@mantine/core";
import Breadcrumb from "@/features/page/components/breadcrumbs/breadcrumb.tsx";

interface Props {
  canEdit?: boolean;
  canDelete?: boolean;
  canShare?: boolean;
  canManagePermissions?: boolean;
}
export default function PageHeader({ canEdit, canDelete, canShare, canManagePermissions }: Props) {
  return (
    <div className={classes.header}>
      <Group justify="space-between" h="100%" px="md" wrap="nowrap" className={classes.group}>
        <Breadcrumb />

        <Group justify="flex-end" h="100%" px="md" wrap="nowrap" gap="var(--mantine-spacing-xs)">
          <PageHeaderMenu canEdit={canEdit} canDelete={canDelete} canShare={canShare} canManagePermissions={canManagePermissions} />
        </Group>
      </Group>
    </div>
  );
}
