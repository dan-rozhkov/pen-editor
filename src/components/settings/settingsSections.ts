import {
  GlobeIcon,
  KeyboardIcon,
  PaletteIcon,
  PuzzlePieceIcon,
  SelectionIcon,
  SparkleIcon,
  UserCircleIcon,
} from "@phosphor-icons/react";

import type { SettingsSection } from "@/lib/openSettings";

export const SETTINGS_NAV: { id: SettingsSection; label: string; icon: typeof UserCircleIcon }[] = [
  { id: "account", label: "Account", icon: UserCircleIcon },
  { id: "appearance", label: "Appearance", icon: PaletteIcon },
  { id: "canvas", label: "Canvas", icon: SelectionIcon },
  { id: "agent", label: "AI agent", icon: SparkleIcon },
  { id: "browser", label: "Browser", icon: GlobeIcon },
  { id: "integrations", label: "Integrations", icon: PuzzlePieceIcon },
  { id: "shortcuts", label: "Keyboard shortcuts", icon: KeyboardIcon },
];
