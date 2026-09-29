/**
 * spinnerComponent.ts
 *
 * CC-style animated spinner with palindromic frame cycle, shimmer verb text,
 * and an optional token counter.
 */

import { createShimmer, type ShimmerController } from './shimmerAnimation';

// ── Constants ──────────────────────────────────────────────────────────────

export const SPINNER_FRAMES = ['·', '✢', '*', '✶', '✻', '✽'] as const;

export const SPINNER_VERBS: string[] = [
  'Working', 'Thinking', 'Computing', 'Brewing', 'Crafting', 'Cobbling',
  'Concocting', 'Orchestrating', 'Contemplating', 'Synthesizing', 'Riveting',
  'Analyzing', 'Composing', 'Devising', 'Evaluating', 'Formulating',
  'Generating', 'Iterating', 'Mapping', 'Optimizing', 'Processing',
  'Reasoning', 'Simulating', 'Weaving', 'Assembling', 'Calibrating',
  'Compiling', 'Decoding', 'Distilling', 'Examining', 'Forging', 'Hashing',
  'Inspecting', 'Linking', 'Merging', 'Parsing', 'Querying', 'Resolving',
  'Scanning', 'Tracing', 'Validating',
  'Abstracting', 'Allocating', 'Bootstrapping', 'Buffering', 'Caching',
  'Calculating', 'Channeling', 'Clustering', 'Coalescing', 'Committing',
  'Comparing', 'Compressing', 'Concatenating', 'Configuring', 'Connecting',
  'Converting', 'Correlating', 'Debugging', 'Decrypting', 'Deduplicating',
  'Deploying', 'Deriving', 'Diagnosing', 'Diffing', 'Dispatching',
  'Downloading', 'Encoding', 'Encrypting', 'Enumerating', 'Estimating',
  'Executing', 'Exporting', 'Extracting', 'Fetching', 'Filtering',
  'Finalizing', 'Formatting', 'Indexing', 'Initializing', 'Injecting',
  'Interpolating', 'Invoking', 'Journaling', 'Loading', 'Logging',
  'Marshalling', 'Measuring', 'Migrating', 'Monitoring', 'Multiplexing',
  'Normalizing', 'Notifying', 'Packaging', 'Paginating', 'Partitioning',
  'Patching', 'Persisting', 'Piping', 'Polling', 'Populating',
  'Prefetching', 'Profiling', 'Projecting', 'Propagating', 'Provisioning',
  'Pruning', 'Publishing', 'Queueing', 'Rebasing', 'Reconciling',
  'Recovering', 'Reducing', 'Refactoring', 'Refreshing', 'Registering',
  'Rehydrating', 'Reindexing', 'Replicating', 'Requesting', 'Restoring',
  'Reticulating', 'Routing', 'Sampling', 'Sanitizing', 'Scheduling',
  'Serializing', 'Sharding', 'Snapshotting', 'Sorting', 'Spawning',
  'Streaming', 'Subscribing', 'Summarizing', 'Synchronizing', 'Synthesizing',
  'Throttling', 'Tokenizing', 'Transforming', 'Transmitting', 'Traversing',
  'Unpacking', 'Uploading', 'Vectorizing', 'Verifying', 'Warming',
  'Grid-tracing', 'Light-cycling', 'Derezzing', 'Bit-wrangling',
  'Trail-blazing', 'Neon-forging', 'Arena-scanning', 'Lobby-wiring',
  'Match-orchestrating', 'Netcode-syncing', 'Lockstep-aligning',
];

// Palindromic cycle: forward frames then reverse without duplicating endpoints
// e.g. [0,1,2,3,4,5,4,3,2,1] for 6 frames
const CYCLE: string[] = [
  ...SPINNER_FRAMES,
  ...[...SPINNER_FRAMES].reverse().slice(1, -1),
];

const FRAME_INTERVAL_MS = 120;

// ── Types ──────────────────────────────────────────────────────────────────

export interface SpinnerController {
  setTokenCount(count: number): void;
  updateTokenTime(): void;
  setSpeed(speed: 'requesting' | 'responding'): void;
  destroy(): void;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatTokens(count: number): string {
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}K tokens`;
  }
  return `${count} tokens`;
}

function pickVerb(): string {
  return SPINNER_VERBS[Math.floor(Math.random() * SPINNER_VERBS.length)];
}

// ── Factory ────────────────────────────────────────────────────────────────

export function createSpinner(container: HTMLElement): SpinnerController {
  // Build DOM structure
  const wrapper = document.createElement('div');
  wrapper.className = 'cc-spinner';

  const charEl = document.createElement('span');
  charEl.className = 'cc-spinner-char';
  charEl.setAttribute('aria-hidden', 'true');

  const textEl = document.createElement('span');
  textEl.className = 'cc-spinner-text';

  const tokensEl = document.createElement('span');
  tokensEl.className = 'cc-spinner-tokens';
  tokensEl.style.cssText = 'margin-left: auto; text-align: right;';

  wrapper.appendChild(charEl);
  wrapper.appendChild(textEl);
  wrapper.appendChild(tokensEl);
  container.appendChild(wrapper);

  // Pick a random verb and start shimmer
  const verb = pickVerb();
  const shimmer: ShimmerController = createShimmer(textEl, `${verb}...`, {
    baseColor: 'rgb(110, 224, 240)',
    shimmerColor: 'rgb(201, 248, 255)',
    speed: 'responding',
    stalledColor: 'rgb(212, 82, 52)',
  });

  // Verb rotation — pick a new random verb every 4 seconds
  const verbInterval = setInterval(() => {
    shimmer.updateText(`${pickVerb()}...`);
  }, 4000);

  // Frame animation (palindromic)
  let frameIndex = 0;
  charEl.textContent = CYCLE[frameIndex];

  const frameInterval = setInterval(() => {
    frameIndex = (frameIndex + 1) % CYCLE.length;
    charEl.textContent = CYCLE[frameIndex];
  }, FRAME_INTERVAL_MS);

  // ── Controller ───────────────────────────────────────────────────────────

  return {
    setTokenCount(count: number): void {
      tokensEl.textContent = formatTokens(count);
    },

    updateTokenTime(): void {
      shimmer.updateTokenTime();
    },

    setSpeed(speed: 'requesting' | 'responding'): void {
      shimmer.setSpeed(speed);
    },

    destroy(): void {
      clearInterval(frameInterval);
      clearInterval(verbInterval);
      shimmer.destroy();
      if (wrapper.parentNode) {
        wrapper.parentNode.removeChild(wrapper);
      }
    },
  };
}
