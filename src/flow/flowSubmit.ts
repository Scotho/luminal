/**
 * SPEC-92: Client-side match-end FLOW reporting.
 *
 * Writes round results to onlineMatches/{matchId}/flowReports/{uid}
 * for the Cloud Function to process. Falls back to localStorage for AI matches.
 */

import { db } from '../firebase';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import type { RoundResult } from './flowTypes';

const LOCAL_STORAGE_KEY = 'luminal-flow-local';

export interface FlowReportEntry {
  round: number;
  awarded: number;
  died: boolean;
}

/**
 * Submit FLOW reports for an online match.
 */
export async function submitFlowReports(
  matchId: string,
  uid: string,
  results: RoundResult[],
): Promise<void> {
  const reports: FlowReportEntry[] = results.map((r, i) => ({
    round: i + 1,
    awarded: r.awarded,
    died: r.died,
  }));

  await setDoc(
    doc(db, 'onlineMatches', matchId, 'flowReports', uid),
    {
      reports,
      submittedAt: serverTimestamp(),
    },
  );
}

/**
 * Store FLOW locally for AI/offline matches.
 * Reconciled to server via claimLocalFlow on next sign-in.
 */
export function storeLocalFlow(awarded: number): void {
  try {
    const stored = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '{"banked":0,"lifetime":0}');
    stored.banked = (stored.banked || 0) + awarded;
    stored.lifetime = (stored.lifetime || 0) + awarded;
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // localStorage may be unavailable
  }
}

/**
 * Read locally-stored FLOW (for display before server reconciliation).
 */
export function getLocalFlow(): { banked: number; lifetime: number } {
  try {
    const stored = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '{"banked":0,"lifetime":0}');
    return { banked: stored.banked || 0, lifetime: stored.lifetime || 0 };
  } catch {
    return { banked: 0, lifetime: 0 };
  }
}
