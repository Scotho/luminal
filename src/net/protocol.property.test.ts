// ── Protocol Property-Based Tests ─────────────────────────
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { isValidRelayMessage, type RelayMessageKind } from './protocol';

const VALID_KINDS: RelayMessageKind[] = [
  'inputs', 'hash', 'snapshot', 'ping', 'pong', 'resync-request',
];

describe('isValidRelayMessage property-based tests', () => {
  // ── Accepts all valid kinds ────────────────────────────

  describe('accepts all valid kinds', () => {
    it('any well-formed message with a valid kind passes validation', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...VALID_KINDS),
          (kind) => {
            const msg = { kind };
            expect(isValidRelayMessage(msg)).toBe(true);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('valid messages with extra properties still pass', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...VALID_KINDS),
          fc.dictionary(
            fc.string({ minLength: 1, maxLength: 10 }),
            fc.oneof(fc.integer(), fc.string(), fc.boolean()),
          ),
          (kind, extras) => {
            const msg = { kind, ...extras };
            // kind may get overwritten by extras — only assert if kind survives
            if (msg.kind === kind) {
              expect(isValidRelayMessage(msg)).toBe(true);
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // ── Rejects bad kinds ──────────────────────────────────

  describe('rejects bad kinds', () => {
    it('random strings that are not valid kinds are rejected', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 30 }),
          (kind) => {
            fc.pre(!VALID_KINDS.includes(kind as RelayMessageKind));
            expect(isValidRelayMessage({ kind })).toBe(false);
          },
        ),
        { numRuns: 200 },
      );
    });

    it('empty string kind is rejected', () => {
      expect(isValidRelayMessage({ kind: '' })).toBe(false);
    });
  });

  // ── Rejects non-objects ────────────────────────────────

  describe('rejects non-objects', () => {
    it('numbers are rejected', () => {
      fc.assert(
        fc.property(fc.double({ noNaN: true }), (val) => {
          expect(isValidRelayMessage(val)).toBe(false);
        }),
        { numRuns: 50 },
      );
    });

    it('strings are rejected', () => {
      fc.assert(
        fc.property(fc.string(), (val) => {
          expect(isValidRelayMessage(val)).toBe(false);
        }),
        { numRuns: 50 },
      );
    });

    it('null and undefined are rejected', () => {
      expect(isValidRelayMessage(null)).toBe(false);
      expect(isValidRelayMessage(undefined)).toBe(false);
    });

    it('booleans are rejected', () => {
      expect(isValidRelayMessage(true)).toBe(false);
      expect(isValidRelayMessage(false)).toBe(false);
    });

    it('arrays are rejected as message kind holders (no kind property)', () => {
      fc.assert(
        fc.property(
          fc.array(fc.integer()),
          (arr) => {
            // Arrays are objects but don't have a valid 'kind' string property
            expect(isValidRelayMessage(arr)).toBe(false);
          },
        ),
        { numRuns: 50 },
      );
    });
  });

  // ── Messages missing kind field ────────────────────────

  describe('missing kind', () => {
    it('objects without kind are rejected', () => {
      fc.assert(
        fc.property(
          fc.dictionary(
            fc.string({ minLength: 1, maxLength: 10 }).filter(s => s !== 'kind'),
            fc.oneof(fc.integer(), fc.string(), fc.boolean()),
          ),
          (obj) => {
            expect(isValidRelayMessage(obj)).toBe(false);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('objects with non-string kind are rejected', () => {
      fc.assert(
        fc.property(
          fc.oneof(fc.integer(), fc.boolean(), fc.constant(null), fc.constant(undefined)),
          (kindVal) => {
            expect(isValidRelayMessage({ kind: kindVal })).toBe(false);
          },
        ),
        { numRuns: 50 },
      );
    });
  });
});
