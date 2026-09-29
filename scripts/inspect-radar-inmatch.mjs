// Diagnostic: observe the #radar element's classList during a local match.
// Starts a local match and captures radar state at multiple checkpoints.

import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: false });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const page = await ctx.newPage();

// Capture console logs
const logs = [];
page.on('console', msg => {
  const t = msg.text();
  if (msg.type() === 'error' || msg.type() === 'warning' || t.includes('RADAR-DEBUG')) {
    logs.push(`[${msg.type()}] ${t}`);
  }
});

await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 60000 });
// Wait for module scripts to settle (Vite imports are ongoing)
await page.waitForTimeout(4000);

// Click-through loading screen first (happens in same page, no nav)
try {
  await page.waitForSelector('#click-prompt.click-prompt--visible', { timeout: 10000 });
  await page.click('#click-prompt');
} catch { /* already past */ }
// Wait for loading screen fade + main menu to become visible
await page.waitForFunction(() => {
  const overlay = document.getElementById('overlay');
  if (!overlay) return false;
  const cs = getComputedStyle(overlay);
  return cs.visibility === 'visible' && parseFloat(cs.opacity) > 0.5;
}, { timeout: 15000 }).catch(() => console.warn('Main menu overlay never became visible'));
await page.waitForTimeout(500);

// Install a MutationObserver on #radar after loading screen is gone
await page.evaluate(() => {
  window.__radarLog = [];
  const start = performance.now();
  const snap = (label) => {
    const r = document.getElementById('radar');
    const rw = document.getElementById('radar-wrap');
    if (!r || !rw) { window.__radarLog.push([label, 'ELEMENT_MISSING']); return; }
    const cs = getComputedStyle(r);
    const csw = getComputedStyle(rw);
    const br = r.getBoundingClientRect();
    window.__radarLog.push([
      (performance.now() - start).toFixed(0) + 'ms',
      label,
      {
        radarClasses: r.className,
        radarDisplay: cs.display,
        radarVisibility: cs.visibility,
        radarOpacity: cs.opacity,
        radarWidth: Math.round(br.width),
        radarHeight: Math.round(br.height),
        wrapClasses: rw.className,
        wrapDisplay: csw.display,
        wrapVisibility: csw.visibility,
        wrapOpacity: csw.opacity,
        radarEnabledState: window.game?.radarEnabled,
        radarMobileHide: window.game?.radarMobileHide,
        gameState: window.game?.state,
      },
    ]);
  };
  window.__snapRadar = snap;
  window.__radarSnapLabel = snap;

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'attributes' && m.attributeName === 'class') {
        const target = m.target;
        const id = target.id || target.className;
        window.__radarLog.push([
          (performance.now() - start).toFixed(0) + 'ms',
          `MUTATION ${id}`,
          { oldClass: m.oldValue, newClass: target.className, stack: new Error().stack.split('\n').slice(2, 5) },
        ]);
      }
    }
  });
  const r = document.getElementById('radar');
  const rw = document.getElementById('radar-wrap');
  if (r) observer.observe(r, { attributes: true, attributeOldValue: true });
  if (rw) observer.observe(rw, { attributes: true, attributeOldValue: true });
  snap('initial');
});

await page.evaluate(() => window.__snapRadar('after-load'));

// Check what localStorage says about radar settings
const lsState = await page.evaluate(() => ({
  radarEnabled: localStorage.getItem('luminal-radar-enabled'),
  radarMobileHide: localStorage.getItem('luminal-radar-mobile-hide'),
  radarSize: localStorage.getItem('luminal-radar-size'),
}));
console.log('localStorage radar settings:', lsState);

// Dump current screen + button visibility before starting + click directly
const preClick = await page.evaluate(() => {
  const btn = document.getElementById('btn-quickstart');
  const main = document.getElementById('main');
  const visibleParents = [];
  let e = btn;
  while (e && visibleParents.length < 6) {
    const cs = getComputedStyle(e);
    visibleParents.push({ id: e.id || e.tagName, display: cs.display, visibility: cs.visibility, opacity: cs.opacity });
    e = e.parentElement;
  }
  // Click directly via JS (bypasses visibility check)
  if (btn) btn.click();
  return {
    quickstartExists: !!btn,
    quickstartVisible: btn ? getComputedStyle(btn).display !== 'none' : false,
    mainScreenClass: main?.className || 'missing',
    bodyClass: document.body.className,
    visibleParents,
    clicked: !!btn,
  };
});
console.log('Pre-click state:', JSON.stringify(preClick, null, 2));

await page.waitForTimeout(500);
await page.evaluate(() => window.__snapRadar('after-start-click'));

// Wait for transition (fade + camera sweep ~1.2s + hold 600ms)
await page.waitForTimeout(2500);
await page.evaluate(() => window.__snapRadar('mid-transition'));

// Wait for countdown to finish (3 beats ~3s) — should be in 'playing' state
await page.waitForTimeout(3500);
await page.evaluate(() => window.__snapRadar('during-playing'));

// Dump all logs
const radarLog = await page.evaluate(() => window.__radarLog);
console.log('\n═════ RADAR STATE TIMELINE ═════');
for (const [t, label, data] of radarLog) {
  console.log(`\n[${t}] ${label}`);
  if (typeof data === 'object') {
    for (const [k, v] of Object.entries(data)) {
      console.log(`  ${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
    }
  } else {
    console.log('  ', data);
  }
}

if (logs.length > 0) {
  console.log('\n═════ CONSOLE LOGS ═════');
  logs.forEach(l => console.log(l));
}

await browser.close();
