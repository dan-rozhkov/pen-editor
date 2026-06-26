import type { ReactNode } from "react";
import {
  FileIcon,
  SparkleIcon,
  DiamondsFourIcon,
  PlusCircleIcon,
} from "@phosphor-icons/react";
import { useLeftSidebarStore } from "@/store/leftSidebarStore";
import type { LeftSection } from "@/store/leftSidebarStore";
import { useVariablesDialogStore } from "@/store/variablesDialogStore";

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
        active
          ? "p-2 rounded-lg bg-accent-primary/10 text-accent-primary transition-colors"
          : "p-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
      }
    >
      {children}
    </button>
  );
}

const SECTIONS: {
  section: LeftSection;
  testid: string;
  title: string;
  icon: ReactNode;
}[] = [
  { section: "pages", testid: "rail-pages", title: "Pages", icon: <FileIcon size={20} /> },
  { section: "agents", testid: "rail-agents", title: "Agents", icon: <SparkleIcon size={20} /> },
  { section: "components", testid: "rail-components", title: "Components", icon: <DiamondsFourIcon size={20} /> },
];

export function LeftRail() {
  const activeSection = useLeftSidebarStore((s) => s.activeSection);
  const setActiveSection = useLeftSidebarStore((s) => s.setActiveSection);
  const openVariables = useVariablesDialogStore((s) => s.setOpen);

  return (
    <div className="w-14 h-full flex flex-col items-center gap-2 py-4 bg-surface-panel border-r border-border-default">
      {SECTIONS.map((item) => (
        <RailButton
          key={item.section}
          testid={item.testid}
          title={item.title}
          active={activeSection === item.section}
          onClick={() => setActiveSection(item.section)}
        >
          {item.icon}
        </RailButton>
      ))}
      <RailButton
        testid="rail-variables"
        title="Variables"
        active={false}
        onClick={() => openVariables(true)}
      >
        <PlusCircleIcon size={20} />
      </RailButton>
    </div>
  );
}
