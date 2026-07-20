import type { ReactNode } from "react";
import {
  FileIcon,
  CardsIcon,
  SparkleIcon,
  DiamondsFourIcon,
  PlusCircleIcon,
  TextAaIcon,
  PaintBrushIcon,
  ChatCircleIcon,
} from "@phosphor-icons/react";
import { useLeftSidebarStore } from "@/store/leftSidebarStore";
import type { LeftSection } from "@/store/leftSidebarStore";
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
  { section: "slides", testid: "rail-slides", title: "Slides", icon: <CardsIcon size={20} weight="light" /> },
  { section: "agents", testid: "rail-agents", title: "Agents", icon: <SparkleIcon size={20} weight="light" /> },
  { section: "components", testid: "rail-components", title: "Assets", icon: <DiamondsFourIcon size={18} weight="light" /> },
  { section: "comments", testid: "rail-comments", title: "Threads", icon: <ChatCircleIcon size={20} weight="light" /> },
];

// Variables/Text styles/Styles are separate rail sections (not tabs, for now)
// that render below a divider — same navigation model as SECTIONS above, just
// visually grouped apart from the core Pages/Agents/Assets triad.
const STYLE_SECTIONS: {
  section: LeftSection;
  testid: string;
  title: string;
  icon: ReactNode;
}[] = [
  { section: "variables", testid: "rail-variables", title: "Variables", icon: <PlusCircleIcon size={20} weight="light" /> },
  { section: "textStyles", testid: "rail-text-styles", title: "Text", icon: <TextAaIcon size={20} weight="light" /> },
  { section: "styles", testid: "rail-styles", title: "Styles", icon: <PaintBrushIcon size={20} weight="light" /> },
];

export function LeftRail() {
  const activeSection = useLeftSidebarStore((s) => s.activeSection);
  const setActiveSection = useLeftSidebarStore((s) => s.setActiveSection);
  const isPanelOpen = useLeftSidebarStore((s) => s.isPanelOpen);
  const setPanelOpen = useLeftSidebarStore((s) => s.setPanelOpen);
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

  const renderRailButton = (item: (typeof SECTIONS)[number]) => (
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
  );

  return (
    <div className="w-14 h-full flex flex-col items-center gap-3 pt-2 pb-4 bg-surface-panel border-r border-border-default">
      {SECTIONS.map(renderRailButton)}
      <div className="h-px w-5 bg-border-default" />
      {STYLE_SECTIONS.map(renderRailButton)}
    </div>
  );
}
