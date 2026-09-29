// ── Profile Data Layer ────────────────────────────────────
import { db } from './firebase';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import type { Timestamp } from 'firebase/firestore';

// ── Interfaces ───────────────────────────────────────────

export interface UserProfile {
  uid: string;
  username: string;
  icon: string;
  about: string;
  // specialPoints is server-awarded — client never writes it
  specialPoints?: number;
  // FLOW fields (SPEC-92) — server-awarded, client never writes
  bankedFlow?: number;
  lifetimeFlow?: number;
  flowSeason?: number;
  createdAt: Date | null;
  socials: {
    discord: string;
    steam: string;
    twitch: string;
    youtube: string;
  };
}

export interface ProfileUpdateData {
  about?: string;
  socials?: UserProfile['socials'];
}

// ── fetchProfile ─────────────────────────────────────────

export async function fetchProfile(uid: string): Promise<UserProfile | null> {
  const snap = await getDoc(doc(db, 'users', uid));
  if (!snap.exists()) return null;

  const data = snap.data();

  // Parse createdAt — may be a Firestore Timestamp, a Date, or absent
  let createdAt: Date | null = null;
  if (data.createdAt) {
    if (typeof (data.createdAt as Timestamp).toDate === 'function') {
      createdAt = (data.createdAt as Timestamp).toDate();
    } else if (data.createdAt instanceof Date) {
      createdAt = data.createdAt;
    }
  }

  const storedSocials: Partial<UserProfile['socials']> = data.socials ?? {};
  const socials: UserProfile['socials'] = {
    discord: storedSocials.discord ?? '',
    steam: storedSocials.steam ?? '',
    twitch: storedSocials.twitch ?? '',
    youtube: storedSocials.youtube ?? '',
  };

  return {
    uid,
    username: data.username ?? '',
    icon: data.icon ?? '',
    about: data.about ?? '',
    specialPoints: Number(data.specialPoints) || 0,
    bankedFlow: Number(data.bankedFlow) || 0,
    lifetimeFlow: Number(data.lifetimeFlow) || 0,
    flowSeason: Number(data.flowSeason) || 1,
    createdAt,
    socials,
  };
}

// ── refreshBankedFlow ────────────────────────────────────

/** Re-fetch just the FLOW balance (e.g., after a purchase). */
export async function refreshBankedFlow(uid: string): Promise<number> {
  const snap = await getDoc(doc(db, 'users', uid));
  if (!snap.exists()) return 0;
  return Number(snap.data().bankedFlow) || 0;
}

// ── updateProfile ────────────────────────────────────────

export async function updateProfile(uid: string, updates: ProfileUpdateData): Promise<void> {
  const fields: Record<string, unknown> = {};

  if (updates.about !== undefined) {
    fields.about = updates.about.slice(0, 280);
  }

  if (updates.socials !== undefined) {
    // Write socials as a complete map so Firestore rules can validate `socials is map`
    fields.socials = updates.socials;
  }

  if (Object.keys(fields).length === 0) return;

  await updateDoc(doc(db, 'users', uid), fields);
}
