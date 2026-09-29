// admin/src/ui/skillRegistry.ts

import { COMMANDS } from '../commandRegistry';

export interface SkillEntry {
  name: string;
  description: string;
  category: string;
  icon: string;
}

const CATEGORY_ICONS: Record<string, string> = {
  report: '&#128202;',
  deploy: '&#128230;',
  dev: '&#128736;',
  workflow: '&#9881;',
  test: '&#9989;',
};

/** All available skills/commands for the popover. */
export function getSkillEntries(): SkillEntry[] {
  return COMMANDS.map(cmd => ({
    name: cmd.name,
    description: cmd.description,
    category: cmd.category,
    icon: CATEGORY_ICONS[cmd.category] ?? '&#9656;',
  }));
}

/** Filter skills by query string (matches name or description). */
export function filterSkills(query: string): SkillEntry[] {
  const q = query.toLowerCase();
  return getSkillEntries().filter(s =>
    s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)
  );
}
