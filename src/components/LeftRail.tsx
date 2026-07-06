import type { ReactNode } from "react";
import {
  FileIcon,
  SparkleIcon,
  DiamondsFourIcon,
  PlusCircleIcon,
  TextAaIcon,
} from "@phosphor-icons/react";
import { useLeftSidebarStore } from "@/store/leftSidebarStore";
import type { LeftSection } from "@/store/leftSidebarStore";
import { useVariablesDialogStore } from "@/store/variablesDialogStore";
import { useTextStylesDialogStore } from "@/store/textStylesDialogStore";
import { useIsMobile } from "@/hooks/useIsMobile";

interface RailButtonProps {
  testid: string;
  title: string;
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}

function RailButton({ testid, title, active, onClick, children }: RailButtonProps) {
  return (
    <button
      data-testid={testid}
      title={title}
      onClick={onClick}
      className={
        "group flex w-full flex-col items-center gap-0.5 text-text-primary transition-colors"
      }
    >
      <span
        className={
          active
            ? "flex size-9 items-center justify-center rounded-lg bg-accent-primary/10 text-accent-primary"
            : "flex size-9 items-center justify-center rounded-lg group-hover:bg-secondary"
        }
      >
        {children}
      </span>
      <span className="max-w-full px-0.5 text-center text-[9px] leading-3">
        {title}
      </span>
    </button>
  );
}

const SECTIONS: {
  section: LeftSection;
  testid: string;
  title: string;
  icon: ReactNode;
}[] = [
  { section: "pages", testid: "rail-pages", title: "Pages", icon: <FileIcon size={20} weight="light" /> },
  { section: "agents", testid: "rail-agents", title: "Agents", icon: <SparkleIcon size={20} weight="light" /> },
  { section: "components", testid: "rail-components", title: "Assets", icon: <DiamondsFourIcon size={18} weight="light" /> },
];

export function LeftRail() {
  const activeSection = useLeftSidebarStore((s) => s.activeSection);
  const setActiveSection = useLeftSidebarStore((s) => s.setActiveSection);
  const isPanelOpen = useLeftSidebarStore((s) => s.isPanelOpen);
  const setPanelOpen = useLeftSidebarStore((s) => s.setPanelOpen);
  const openVariables = useVariablesDialogStore((s) => s.setOpen);
  const openTextStyles = useTextStylesDialogStore((s) => s.setOpen);
  const isMobile = useIsMobile();

  // On mobile the panel is a full-width overlay the rail toggles: tapping the
  // active icon closes it, tapping another opens that section.
  const handleSectionClick = (section: LeftSection) => {
    if (isMobile) {
      if (isPanelOpen && activeSection === section) {
        setPanelOpen(false);
      } else {
        setActiveSection(section);
        setPanelOpen(true);
      }
    } else {
      setActiveSection(section);
    }
  };

  return (
    <div className="w-14 h-full flex flex-col items-center gap-3 pt-2 pb-4 bg-surface-panel border-r border-border-default">
      {SECTIONS.map((item) => (
        <RailButton
          key={item.section}
          testid={item.testid}
          title={item.title}
          active={
            isMobile
              ? isPanelOpen && activeSection === item.section
              : activeSection === item.section
          }
          onClick={() => handleSectionClick(item.section)}
        >
          {item.icon}
        </RailButton>
      ))}
      <div className="h-px w-5 bg-border-default" />
      <RailButton
        testid="rail-variables"
        title="Variables"
        active={false}
        onClick={() => openVariables(true)}
      >
        <PlusCircleIcon size={20} weight="light" />
      </RailButton>
      <RailButton
        testid="rail-text-styles"
        title="Text styles"
        active={false}
        onClick={() => openTextStyles(true)}
      >
        <TextAaIcon size={20} weight="light" />
      </RailButton>
    </div>
  );
}
