// ── Profile Data Layer Tests ──────────────────────────────
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

// ── Mock Firebase modules BEFORE importing profile ───────
const mockGetDoc = vi.fn();
const mockUpdateDoc = vi.fn(() => Promise.resolve());
const mockDoc = vi.fn((_db: unknown, _col: string, id: string) => ({ __id: id }));

vi.mock('firebase/firestore', () => ({
  doc: (...args: unknown[]) => mockDoc(...args),
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
  updateDoc: (...args: unknown[]) => mockUpdateDoc(...args),
}));

vi.mock('./firebase', () => ({
  db: { __db: true },
  auth: { currentUser: null },
}));

import { fetchProfile, updateProfile } from './profile';

// ── Helpers ──────────────────────────────────────────────

function makeSnap(data: Record<string, unknown> | null) {
  return {
    exists: () => data !== null,
    data: () => data ?? {},
  };
}

function makeTimestamp(date: Date) {
  return { toDate: () => date };
}

// ── fetchProfile ─────────────────────────────────────────

describe('fetchProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null for non-existent user', async () => {
    mockGetDoc.mockResolvedValue(makeSnap(null));
    const result = await fetchProfile('uid-missing');
    expect(result).toBeNull();
  });

  it('returns profile with defaults for missing optional fields', async () => {
    mockGetDoc.mockResolvedValue(makeSnap({ username: 'TestUser', icon: 'star' }));
    const profile = await fetchProfile('uid-1');
    expect(profile).not.toBeNull();
    expect(profile!.uid).toBe('uid-1');
    expect(profile!.username).toBe('TestUser');
    expect(profile!.icon).toBe('star');
    expect(profile!.about).toBe('');
    expect(profile!.createdAt).toBeNull();
    expect(profile!.socials).toEqual({
      discord: '',
      steam: '',
      twitch: '',
      youtube: '',
    });
  });

  it('parses createdAt Firestore Timestamp into a Date', async () => {
    const date = new Date('2025-01-15T10:00:00Z');
    mockGetDoc.mockResolvedValue(makeSnap({
      username: 'TestUser',
      icon: 'star',
      createdAt: makeTimestamp(date),
    }));
    const profile = await fetchProfile('uid-2');
    expect(profile!.createdAt).toBeInstanceOf(Date);
    expect(profile!.createdAt!.toISOString()).toBe(date.toISOString());
  });

  it('merges partial socials with defaults for missing keys', async () => {
    mockGetDoc.mockResolvedValue(makeSnap({
      username: 'StreamerUser',
      socials: { twitch: 'streamerguy', youtube: 'yt-channel' },
    }));
    const profile = await fetchProfile('uid-3');
    expect(profile!.socials).toEqual({
      discord: '',
      steam: '',
      twitch: 'streamerguy',
      youtube: 'yt-channel',
    });
  });

  it('returns all social fields when fully populated', async () => {
    mockGetDoc.mockResolvedValue(makeSnap({
      username: 'FullUser',
      socials: {
        discord: 'myDiscord#1234',
        steam: 'steamHandle',
        twitch: 'twitchHandle',
        youtube: '@youtubeHandle',
      },
    }));
    const profile = await fetchProfile('uid-4');
    expect(profile!.socials.discord).toBe('myDiscord#1234');
    expect(profile!.socials.steam).toBe('steamHandle');
    expect(profile!.socials.twitch).toBe('twitchHandle');
    expect(profile!.socials.youtube).toBe('@youtubeHandle');
  });

  it('returns about string when present', async () => {
    mockGetDoc.mockResolvedValue(makeSnap({
      username: 'AboutUser',
      about: 'I love Tron!',
    }));
    const profile = await fetchProfile('uid-5');
    expect(profile!.about).toBe('I love Tron!');
  });
});

// ── updateProfile ────────────────────────────────────────

describe('updateProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('truncates about to 280 characters', async () => {
    const longAbout = 'a'.repeat(400);
    await updateProfile('uid-1', { about: longAbout });
    expect(mockUpdateDoc).toHaveBeenCalledOnce();
    const fields = (mockUpdateDoc as Mock).mock.calls[0][1];
    expect(fields.about).toHaveLength(280);
    expect(fields.about).toBe('a'.repeat(280));
  });

  it('preserves about under 280 characters unchanged', async () => {
    await updateProfile('uid-1', { about: 'Short bio' });
    const fields = (mockUpdateDoc as Mock).mock.calls[0][1];
    expect(fields.about).toBe('Short bio');
  });

  it('passes socials through as a full map', async () => {
    await updateProfile('uid-2', { socials: { twitch: 'mychannel', discord: 'myserver' } });
    expect(mockUpdateDoc).toHaveBeenCalledOnce();
    const fields = (mockUpdateDoc as Mock).mock.calls[0][1];
    expect(fields.socials).toEqual({ twitch: 'mychannel', discord: 'myserver' });
  });

  it('does not call updateDoc when no fields are provided', async () => {
    await updateProfile('uid-3', {});
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });

  it('can update both about and socials in one call', async () => {
    await updateProfile('uid-4', { about: 'Hello', socials: { steam: 'steamName' } });
    expect(mockUpdateDoc).toHaveBeenCalledOnce();
    const fields = (mockUpdateDoc as Mock).mock.calls[0][1];
    expect(fields.about).toBe('Hello');
    expect(fields.socials).toEqual({ steam: 'steamName' });
  });
});
