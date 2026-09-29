// ── Authentication ───────────────────────────────────────
import { auth, db, functions } from './firebase';
import { httpsCallable } from 'firebase/functions';
import {
  signInWithPopup,
  GoogleAuthProvider,
  GithubAuthProvider,
  OAuthProvider,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  sendEmailVerification,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
  signInWithPhoneNumber,
  RecaptchaVerifier,
  signInAnonymously,
  onAuthStateChanged,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import type { User, Unsubscribe, ConfirmationResult } from 'firebase/auth';
import {
  doc, getDoc, updateDoc,
} from 'firebase/firestore';

const googleProvider: GoogleAuthProvider = new GoogleAuthProvider();
const appleProvider: OAuthProvider = new OAuthProvider('apple.com');
const githubProvider: GithubAuthProvider = new GithubAuthProvider();
const microsoftProvider: OAuthProvider = new OAuthProvider('microsoft.com');

// ── Email Link (Passwordless) ────────────────────────────
const actionCodeSettings: { url: string; handleCodeInApp: boolean } = {
  // URL to redirect back to after clicking the email link
  url: window.location.origin + '/',
  handleCodeInApp: true,
};

export async function sendEmailLink(email: string): Promise<void> {
  await sendSignInLinkToEmail(auth, email, actionCodeSettings);
  // Save email locally so we can complete sign-in on redirect
  window.localStorage.setItem('luminal-email-for-signin', email);
}

export function checkEmailLinkRedirect(): Promise<{ user: User; needsUsername: boolean }> | null {
  if (isSignInWithEmailLink(auth, window.location.href)) {
    let email: string | null = window.localStorage.getItem('luminal-email-for-signin');
    if (!email) {
      // User opened link on different device — prompt for email
      email = window.prompt('Please enter your email to confirm sign-in:');
    }
    if (email) {
      return signInWithEmailLink(auth, email, window.location.href)
        .then(async (result) => {
          window.localStorage.removeItem('luminal-email-for-signin');
          // Clean up URL
          window.history.replaceState(null, '', window.location.origin + '/');
          const userDoc = await getDoc(doc(db, 'users', result.user.uid));
          return { user: result.user, needsUsername: !userDoc.exists() };
        });
    }
  }
  return null;
}

// ── Google SSO ───────────────────────────────────────────
export async function signInWithGoogle(): Promise<{ user: User; needsUsername: boolean }> {
  const result = await signInWithPopup(auth, googleProvider);
  const userDoc = await getDoc(doc(db, 'users', result.user.uid));
  return { user: result.user, needsUsername: !userDoc.exists() };
}

// ── Email / Password ────────────────────────────────────
export async function signUpWithEmail(
  email: string, password: string, username: string,
): Promise<{ user: User }> {
  const trimmed: string = username.trim();
  if (trimmed.length < 3 || trimmed.length > 20) throw new Error('Username must be 3-20 characters');
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) throw new Error('Letters, numbers, _ and - only');
  const result = await createUserWithEmailAndPassword(auth, email, password);
  await setUsernameForUser(result.user.uid, email, trimmed);
  await sendEmailVerification(result.user);
  return { user: result.user };
}

export async function signInWithEmail(
  email: string, password: string,
): Promise<{ user: User; needsUsername: boolean }> {
  const result = await signInWithEmailAndPassword(auth, email, password);
  const userDoc = await getDoc(doc(db, 'users', result.user.uid));
  return { user: result.user, needsUsername: !userDoc.exists() };
}

export async function resetPassword(email: string): Promise<void> {
  await sendPasswordResetEmail(auth, email);
}

// ── Apple Sign-In ───────────────────────────────────────
export async function signInWithApple(): Promise<{ user: User; needsUsername: boolean }> {
  const result = await signInWithPopup(auth, appleProvider);
  const userDoc = await getDoc(doc(db, 'users', result.user.uid));
  return { user: result.user, needsUsername: !userDoc.exists() };
}

// ── GitHub Sign-In ──────────────────────────────────────
export async function signInWithGitHub(): Promise<{ user: User; needsUsername: boolean }> {
  const result = await signInWithPopup(auth, githubProvider);
  const userDoc = await getDoc(doc(db, 'users', result.user.uid));
  return { user: result.user, needsUsername: !userDoc.exists() };
}

// ── Microsoft Sign-In ───────────────────────────────────
export async function signInWithMicrosoft(): Promise<{ user: User; needsUsername: boolean }> {
  const result = await signInWithPopup(auth, microsoftProvider);
  const userDoc = await getDoc(doc(db, 'users', result.user.uid));
  return { user: result.user, needsUsername: !userDoc.exists() };
}


// ── Phone Sign-In ───────────────────────────────────────
let phoneRecaptcha: RecaptchaVerifier | null = null;

export function initPhoneRecaptcha(): RecaptchaVerifier {
  if (phoneRecaptcha) return phoneRecaptcha;
  phoneRecaptcha = new RecaptchaVerifier(auth, 'recaptcha-container', { size: 'invisible' });
  return phoneRecaptcha;
}

export async function sendPhoneCode(phoneNumber: string): Promise<ConfirmationResult> {
  const verifier = initPhoneRecaptcha();
  return signInWithPhoneNumber(auth, phoneNumber, verifier);
}

export async function verifyPhoneCode(
  confirmationResult: ConfirmationResult, code: string,
): Promise<{ user: User; needsUsername: boolean }> {
  const result = await confirmationResult.confirm(code);
  const userDoc = await getDoc(doc(db, 'users', result.user.uid));
  return { user: result.user, needsUsername: !userDoc.exists() };
}

// ── Username Management ──────────────────────────────────
export async function setUsernameForUser(uid: string, email: string, username: string): Promise<void> {
  const trimmed: string = username.trim();
  if (trimmed.length < 3 || trimmed.length > 20) {
    throw new Error('Username must be 3-20 characters');
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
    throw new Error('Letters, numbers, _ and - only');
  }

  const callable = httpsCallable(functions, 'claimUsername');
  try {
    await callable({ username: trimmed, email: email || '' });
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string };
    if (err.code === 'functions/already-exists') {
      throw new Error('Username is already taken', { cause: e });
    }
    throw new Error(err.message || 'Failed to claim username', { cause: e });
  }
}

export async function isUsernameTaken(username: string): Promise<boolean> {
  const snap = await getDoc(doc(db, 'usernames', username.toLowerCase()));
  return snap.exists();
}

export async function getUsername(uid: string): Promise<string | null> {
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? snap.data().username : null;
}

export async function getUserIcon(uid: string): Promise<string | null> {
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? (snap.data().icon || null) : null;
}

export async function getUserSettings(uid: string): Promise<Record<string, string> | null> {
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? (snap.data().settings || null) : null;
}

/** Backfill icon for existing users who don't have one yet. */
export async function ensureUserIcon(uid: string): Promise<{ icon: string | null; awarded: boolean }> {
  const snap = await getDoc(doc(db, 'users', uid));
  if (!snap.exists()) return { icon: null, awarded: false };
  const data = snap.data();
  if (data.icon) return { icon: data.icon, awarded: false };
  // Backfill: set icon for existing user
  await updateDoc(doc(db, 'users', uid), { icon: 'star' });
  return { icon: 'star', awarded: true };
}

/** Get the Firebase Auth account creation timestamp for backfill. */
export function getAuthCreationTime(): Date | null {
  const user = auth.currentUser;
  if (!user?.metadata.creationTime) return null;
  return new Date(user.metadata.creationTime);
}

// ── Lobby persistence (survives refresh) ─────────────────
export async function setUserLobby(uid: string, lobbyId: string, role: 'host' | 'guest'): Promise<void> {
  await updateDoc(doc(db, 'users', uid), { currentLobby: lobbyId, lobbyRole: role });
}

export async function clearUserLobby(uid: string): Promise<void> {
  await updateDoc(doc(db, 'users', uid), { currentLobby: null, lobbyRole: null });
}

export async function getUserLobby(uid: string): Promise<{ lobbyId: string; role: 'host' | 'guest' } | null> {
  const snap = await getDoc(doc(db, 'users', uid));
  if (!snap.exists()) return null;
  const data = snap.data();
  if (data.currentLobby && data.lobbyRole) {
    return { lobbyId: data.currentLobby, role: data.lobbyRole };
  }
  return null;
}

// ── Sign out ─────────────────────────────────────────────
export async function signOutUser(): Promise<void> {
  await firebaseSignOut(auth);
  // Re-sign in anonymously for presence tracking
  await signInAnonymously(auth);
}

// ── Anonymous sign-in (for presence) ─────────────────────
// Waits for Firebase to restore persisted session before deciding to sign in anonymously
export function signInAnon(): Promise<void> {
  return new Promise<void>((resolve) => {
    const unsub: Unsubscribe = onAuthStateChanged(auth, async (user: User | null) => {
      unsub(); // only need the first callback
      if (!user) {
        await signInAnonymously(auth);
      }
      resolve();
    });
  });
}

// ── Auth state observer ──────────────────────────────────
export function onAuthChange(callback: (user: User | null) => void): Unsubscribe {
  return onAuthStateChanged(auth, callback);
}

export function getCurrentUser(): User | null {
  return auth.currentUser;
}
