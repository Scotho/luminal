// ── Font Loader — dynamic Google Fonts loading + CSS variable application ─────

export interface FontPreset {
  /** Unique key stored in settings */
  key: string;
  /** Human-readable label shown in dropdown */
  label: string;
  /** CSS font-family value for --font-body */
  body: string;
  /** CSS font-family value for --font-display */
  display: string;
  /**
   * Google Fonts URL to load (null = already loaded or system font).
   * Only the *selected* preset is loaded — not all of them.
   */
  googleUrl: string | null;
  /** Short category hint shown in the selector */
  category: string;
}

export const FONT_PRESETS: readonly FontPreset[] = [
  {
    key: 'default',
    label: 'Orbitron + Rajdhani',
    body: "'Rajdhani', 'Segoe UI', system-ui, sans-serif",
    display: "'Orbitron', 'Courier New', monospace",
    googleUrl: null, // already loaded via <link> in index.html
    category: 'Default',
  },
  {
    key: 'inter',
    label: 'Inter',
    body: "'Inter', 'Segoe UI', system-ui, sans-serif",
    display: "'Inter', 'Segoe UI', system-ui, sans-serif",
    googleUrl: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;900&display=swap',
    category: 'Clean sans-serif',
  },
  {
    key: 'ibm-plex',
    label: 'IBM Plex Sans',
    body: "'IBM Plex Sans', 'Segoe UI', system-ui, sans-serif",
    display: "'IBM Plex Sans', 'Segoe UI', system-ui, sans-serif",
    googleUrl: 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;600;700&display=swap',
    category: 'Clean sans-serif',
  },
  {
    key: 'space-grotesk',
    label: 'Space Grotesk',
    body: "'Space Grotesk', 'Segoe UI', system-ui, sans-serif",
    display: "'Space Grotesk', 'Segoe UI', system-ui, sans-serif",
    googleUrl: 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&display=swap',
    category: 'Geometric',
  },
  {
    key: 'outfit',
    label: 'Outfit',
    body: "'Outfit', 'Segoe UI', system-ui, sans-serif",
    display: "'Outfit', 'Segoe UI', system-ui, sans-serif",
    googleUrl: 'https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700;900&display=swap',
    category: 'Geometric',
  },
  {
    key: 'exo2',
    label: 'Exo 2',
    body: "'Exo 2', 'Segoe UI', system-ui, sans-serif",
    display: "'Exo 2', 'Segoe UI', system-ui, sans-serif",
    googleUrl: 'https://fonts.googleapis.com/css2?family=Exo+2:wght@400;600;700;900&display=swap',
    category: 'Tech / sci-fi',
  },
  {
    key: 'orbitron-inter',
    label: 'Orbitron + Inter',
    body: "'Inter', 'Segoe UI', system-ui, sans-serif",
    display: "'Orbitron', 'Courier New', monospace",
    googleUrl: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;900&display=swap',
    category: 'Hybrid',
  },
  {
    key: 'jetbrains-mono',
    label: 'JetBrains Mono',
    body: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', monospace",
    display: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', monospace",
    googleUrl: 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&display=swap',
    category: 'Monospace',
  },
] as const;

/** Currently injected <link> element (if any). */
let _activeLinkEl: HTMLLinkElement | null = null;

/**
 * Load a Google Font stylesheet dynamically.
 * Returns a promise that resolves when the stylesheet is loaded.
 * Removes any previously-loaded font stylesheet first.
 */
function loadGoogleFont(url: string): Promise<void> {
  // Don't reload the same URL
  if (_activeLinkEl && _activeLinkEl.href === url) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    // Remove old dynamic link
    if (_activeLinkEl) {
      _activeLinkEl.remove();
      _activeLinkEl = null;
    }

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = url;
    link.addEventListener('load', () => resolve());
    link.addEventListener('error', () => reject(new Error(`Failed to load font: ${url}`)));
    document.head.appendChild(link);
    _activeLinkEl = link;
  });
}

/**
 * Apply a font preset — loads the Google Font if needed, then sets CSS variables.
 * Safe to call at any time (startup or setting change).
 */
export async function applyFontPreset(key: string): Promise<void> {
  const preset = FONT_PRESETS.find(p => p.key === key) ?? FONT_PRESETS[0];

  // Load the Google Font stylesheet if this preset needs one
  if (preset.googleUrl) {
    try {
      await loadGoogleFont(preset.googleUrl);
    } catch (err) {
      console.warn('[FontLoader]', err);
      // Fall through — the CSS will use the fallback stack
    }
  } else {
    // Remove any previously-loaded dynamic font
    if (_activeLinkEl) {
      _activeLinkEl.remove();
      _activeLinkEl = null;
    }
  }

  // Update CSS custom properties
  const root = document.documentElement;
  root.style.setProperty('--font-body', preset.body);
  root.style.setProperty('--font-display', preset.display);
}
