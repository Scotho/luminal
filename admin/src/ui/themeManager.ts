export interface ThemePreset {
  key: string;
  label: string;
  description: string;
  themeColor: string;
}

export const THEME_PRESETS: readonly ThemePreset[] = [
  {
    key: 'luminal',
    label: 'Luminal',
    description: 'Game-aligned teal and amber on deep black.',
    themeColor: '#05080c',
  },
  {
    key: 'graphite',
    label: 'Graphite',
    description: 'Professional slate with sky-blue accents.',
    themeColor: '#0f172a',
  },
  {
    key: 'midnight',
    label: 'Midnight',
    description: 'True OLED black with indigo accents for low-light use.',
    themeColor: '#000000',
  },
  {
    key: 'arctic',
    label: 'Arctic',
    description: 'Clean light mode for daytime use.',
    themeColor: '#eff4fc',
  },
  {
    key: 'monokai',
    label: 'Monokai',
    description: 'Editor charcoal with vivid syntax colors.',
    themeColor: '#272822',
  },
  {
    key: 'obsidian',
    label: 'Obsidian',
    description: 'Warm charcoal with amber accents.',
    themeColor: '#16140e',
  },
  {
    key: 'carbon',
    label: 'Carbon',
    description: 'Cool dark gray with muted green accents.',
    themeColor: '#16161a',
  },
  {
    key: 'parchment',
    label: 'Parchment',
    description: 'Warm ivory with brown and sienna accents.',
    themeColor: '#f7f2eb',
  },
  {
    key: 'glacier',
    label: 'Glacier',
    description: 'Crisp white with steel-blue accents.',
    themeColor: '#f4f7fa',
  },
  {
    key: 'velocity',
    label: 'Velocity',
    description: 'Project-board blues on a clean canvas.',
    themeColor: '#f4f5f7',
  },
  {
    key: 'poke',
    label: 'Poke',
    description: 'Friendly social blue on white.',
    themeColor: '#f0f2f5',
  },
] as const;

export type ThemeKey = typeof THEME_PRESETS[number]['key'];

const LEGACY_THEME_KEY = 'luminal-admin-theme';

export function normalizeTheme(theme: string | null | undefined): ThemeKey {
  if (theme?.startsWith('"')) {
    try {
      theme = JSON.parse(theme) as string;
    } catch {
      // Fall through and use the raw value.
    }
  }
  if (!theme || theme === 'dark') return 'graphite';
  if (theme === 'light') return 'arctic';
  if (theme === 'executive') return 'graphite';
  const match = THEME_PRESETS.find((preset) => preset.key === theme);
  return (match?.key ?? 'graphite') as ThemeKey;
}

export function applyTheme(theme: string): ThemeKey {
  const normalized = normalizeTheme(theme);
  document.body.dataset.theme = normalized;
  const lightThemes = ['arctic', 'parchment', 'glacier', 'velocity', 'poke'];
  document.body.classList.toggle('light-theme', lightThemes.includes(normalized));
  localStorage.setItem(LEGACY_THEME_KEY, normalized);

  const meta = document.querySelector('meta[name="theme-color"]');
  const themeColor = THEME_PRESETS.find((preset) => preset.key === normalized)?.themeColor ?? '#0f172a';
  if (meta) meta.setAttribute('content', themeColor);

  return normalized;
}
