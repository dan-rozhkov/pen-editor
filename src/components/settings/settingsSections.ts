import {
  BookOpenIcon,
  BrainIcon,
  GlobeIcon,
  KeyboardIcon,
  LockIcon,
  PaletteIcon,
  PuzzlePieceIcon,
  SelectionIcon,
  SlidersHorizontalIcon,
  SparkleIcon,
  UserCircleIcon,
} from "@/components/icons";

import type { SettingsSection } from "@/lib/openSettings";

export const SETTINGS_NAV: { id: SettingsSection; label: string; icon: typeof UserCircleIcon }[] = [
  { id: "account", label: "Account", icon: UserCircleIcon },
  { id: "appearance", label: "Appearance", icon: PaletteIcon },
  { id: "canvas", label: "Canvas", icon: SelectionIcon },
  { id: "agent", label: "AI agent", icon: SparkleIcon },
  { id: "memory", label: "Agent memory", icon: BrainIcon },
  { id: "skills", label: "Skills", icon: BookOpenIcon },
  { id: "browser", label: "Browser", icon: GlobeIcon },
  { id: "integrations", label: "Integrations", icon: PuzzlePieceIcon },
  { id: "privacy", label: "Data & privacy", icon: LockIcon },
  { id: "advanced", label: "Advanced", icon: SlidersHorizontalIcon },
  { id: "shortcuts", label: "Keyboard shortcuts", icon: KeyboardIcon },
];
