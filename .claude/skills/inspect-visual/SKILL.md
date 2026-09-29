---
name: inspect-visual
description: Two-tier visual testing — Playwright pixel diff + Qwen-VL semantic analysis for game screens
---

# Visual Inspection Skill

## Usage
`/inspect-visual <screen-type>` — Run two-tier visual test.
Screen types: lobby, match, main-menu

## Two-Tier Validation
1. **Tier 1 (Pixel):** Playwright screenshot -> compare against baseline (0.2% threshold)
2. **Tier 2 (Semantic):** Only if pixel fails -> Qwen-VL via `/__admin_exec/ollama-vision`

## Results
- Pixel pass -> PASS (green)
- Pixel fail + semantic pass -> SOFT PASS (yellow)
- Both fail -> FAIL (red)

## Confidence Thresholds
- >= 80: Accepted
- 60-79: Uncertain (human review)
- < 60: Unreliable

## Steps
1. Capture: `npx playwright screenshot http://localhost:5173 --viewport-size=1280,720`
2. Compare against `tests/e2e/baselines/<screen>-baseline.png`
3. If pixel fails, send to Qwen-VL with assertions from `admin/data/visual-assertions.json`
