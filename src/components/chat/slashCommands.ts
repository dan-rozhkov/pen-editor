export interface SlashCommand {
  name: string;
  description: string;
  category: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  // Diagnostic
  { name: "audit", description: "Technical quality audit", category: "Diagnostic" },
  { name: "critique", description: "UX and design review", category: "Diagnostic" },
  // Quality
  { name: "normalize", description: "Align with design system", category: "Quality" },
  { name: "polish", description: "Final pass before shipping", category: "Quality" },
  { name: "optimize", description: "Performance improvements", category: "Quality" },
  { name: "harden", description: "Error handling & edge cases", category: "Quality" },
  // Intensity
  { name: "quieter", description: "Tone down bold designs", category: "Intensity" },
  { name: "bolder", description: "Amplify timid designs", category: "Intensity" },
  // Adaptation
  { name: "clarify", description: "Improve UX copy", category: "Adaptation" },
  { name: "distill", description: "Strip to essence", category: "Adaptation" },
  { name: "adapt", description: "Different devices/contexts", category: "Adaptation" },
  // Enhancement
  { name: "colorize", description: "Add strategic color", category: "Enhancement" },
  { name: "delight", description: "Add personality", category: "Enhancement" },
  // System
  { name: "teach-impeccable", description: "One-time project context gathering", category: "System" },
  { name: "extract", description: "Create design system elements", category: "System" },
  { name: "onboard", description: "Onboarding & empty states", category: "System" },
];
