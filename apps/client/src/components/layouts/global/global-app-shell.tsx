import { AppShell, Container } from "@mantine/core";
import React, { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import SettingsSidebar from "@/components/settings/settings-sidebar.tsx";
import { useAtom } from "jotai";
import {
  asideStateAtom,
  asideWidthAtom,
  desktopSidebarAtom,
  mobileSidebarAtom,
  sidebarWidthAtom,
} from "@/components/layouts/global/hooks/atoms/sidebar-atom.ts";
import { SpaceSidebar } from "@/features/space/components/sidebar/space-sidebar.tsx";
import { AppHeader } from "@/components/layouts/global/app-header.tsx";
import Aside from "@/components/layouts/global/aside.tsx";
import classes from "./app-shell.module.css";
import { useTrialEndAction } from "@/ee/hooks/use-trial-end-action.tsx";
import { useToggleSidebar } from "@/components/layouts/global/hooks/hooks/use-toggle-sidebar.ts";

export default function GlobalAppShell({
  children,
}: {
  children: React.ReactNode;
}) {
  useTrialEndAction();
  const [mobileOpened] = useAtom(mobileSidebarAtom);
  const toggleMobile = useToggleSidebar(mobileSidebarAtom);
  const [desktopOpened] = useAtom(desktopSidebarAtom);
  const [{ isAsideOpen }] = useAtom(asideStateAtom);
  const [sidebarWidth, setSidebarWidth] = useAtom(sidebarWidthAtom);
  const [asideWidth, setAsideWidth] = useAtom(asideWidthAtom);
  const [isResizing, setIsResizing] = useState(false);
  const [isAsideResizing, setIsAsideResizing] = useState(false);
  const sidebarRef = useRef(null);
  const asideRef = useRef<HTMLElement>(null);

  const startResizing = React.useCallback((mouseDownEvent) => {
    mouseDownEvent.preventDefault();
    setIsResizing(true);
  }, []);

  const stopResizing = React.useCallback(() => {
    setIsResizing(false);
  }, []);

  const resize = React.useCallback(
    (mouseMoveEvent) => {
      if (isResizing) {
        const newWidth =
          mouseMoveEvent.clientX -
          sidebarRef.current.getBoundingClientRect().left;
        if (newWidth < 220) {
          setSidebarWidth(220);
          return;
        }
        if (newWidth > 600) {
          setSidebarWidth(600);
          return;
        }
        setSidebarWidth(newWidth);
      }
    },
    [isResizing],
  );

  // Aside resize handlers
  const startAsideResizing = React.useCallback((mouseDownEvent: React.MouseEvent) => {
    mouseDownEvent.preventDefault();
    setIsAsideResizing(true);
  }, []);

  const stopAsideResizing = React.useCallback(() => {
    setIsAsideResizing(false);
  }, []);

  const resizeAside = React.useCallback(
    (mouseMoveEvent: MouseEvent) => {
      if (isAsideResizing && asideRef.current) {
        const asideRect = asideRef.current.getBoundingClientRect();
        const newWidth = asideRect.right - mouseMoveEvent.clientX;
        if (newWidth < 350) {
          setAsideWidth(350);
          return;
        }
        if (newWidth > 700) {
          setAsideWidth(700);
          return;
        }
        setAsideWidth(newWidth);
      }
    },
    [isAsideResizing],
  );

  useEffect(() => {
    //https://codesandbox.io/p/sandbox/kz9de
    window.addEventListener("mousemove", resize);
    window.addEventListener("mouseup", stopResizing);
    return () => {
      window.removeEventListener("mousemove", resize);
      window.removeEventListener("mouseup", stopResizing);
    };
  }, [resize, stopResizing]);

  useEffect(() => {
    window.addEventListener("mousemove", resizeAside);
    window.addEventListener("mouseup", stopAsideResizing);
    return () => {
      window.removeEventListener("mousemove", resizeAside);
      window.removeEventListener("mouseup", stopAsideResizing);
    };
  }, [resizeAside, stopAsideResizing]);

  const location = useLocation();
  const isSettingsRoute = location.pathname.startsWith("/settings");
  const isSpaceRoute = location.pathname.startsWith("/s/");
  const isHomeRoute = location.pathname.startsWith("/home");
  const isSpacesRoute = location.pathname === "/spaces";
  const isPageRoute = location.pathname.includes("/p/");
  const hideSidebar = isHomeRoute || isSpacesRoute;

  return (
    <AppShell
      header={{ height: 45 }}
      navbar={
        !hideSidebar && {
          width: isSpaceRoute ? sidebarWidth : 300,
          breakpoint: "sm",
          collapsed: {
            mobile: !mobileOpened,
            desktop: !desktopOpened,
          },
        }
      }
      aside={
        isPageRoute && {
          width: isAsideOpen ? asideWidth : 350,
          breakpoint: "sm",
          collapsed: { mobile: !isAsideOpen, desktop: !isAsideOpen },
        }
      }
      padding="md"
    >
      <AppShell.Header px="md" className={classes.header}>
        <AppHeader />
      </AppShell.Header>
      {!hideSidebar && (
        <AppShell.Navbar
          className={classes.navbar}
          withBorder={false}
          ref={sidebarRef}
        >
          <div className={classes.resizeHandle} onMouseDown={startResizing} />
          {isSpaceRoute && <SpaceSidebar />}
          {isSettingsRoute && <SettingsSidebar />}
        </AppShell.Navbar>
      )}
      <AppShell.Main>
        {isSettingsRoute ? (
          <Container size={850}>{children}</Container>
        ) : (
          children
        )}
      </AppShell.Main>

      {isPageRoute && (
        <AppShell.Aside className={classes.aside} p="md" withBorder={false} ref={asideRef}>
          {isAsideOpen && (
            <div className={classes.asideResizeHandle} onMouseDown={startAsideResizing} />
          )}
          <Aside />
        </AppShell.Aside>
      )}
    </AppShell>
  );
}
