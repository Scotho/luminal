// ── Auth Flow Wiring ─────────────────────────────────────────────────────────
// Wires initAuthUI with sub-module user-update callbacks and profile click
// handlers. This is the "auth flow setup" step — runs after all UI modules
// are initialized.

import {
  initAuthUI, getCurrentIcon,
} from './authUI';
import { updateCurrentUser as updateLBUser, setProfileClickHandler as setLBProfileClickHandler } from './leaderboardUI';
import { updateCurrentUser as updateFriendsUser, setFriendProfileClickHandler, _startFriendsListeners, _stopFriendsListeners } from './friendsUI';
import { updateCurrentUser as updateChatUser } from './chatUI';
import { updateCurrentUser as updateOnlineUser, setOnlineProfileClickHandler } from './onlineUI';
import { updateCurrentUser as updateLobbyUser, setLobbyProfileClickHandler, _checkLobbyInvite, _checkPendingLobby, _checkSavedLobby } from './lobby/lobbyUI';
import { updateCurrentUser as updateNotifUser } from './notifUI';
import { updateSocialAuthButton } from './socialUI';
import { openProfile } from './profileUI';
import {
  navigateTo, navigateReset, navigateBack, showScreen,
  getCurrentScreen, setCurrentScreen,
} from './navigation';

interface AuthWiringDeps {
  updateOnlineUI(): void;
}

export function initAuthWiring(deps: AuthWiringDeps): void {
  const { updateOnlineUI } = deps;

  // Wire sub-module user updates — called on every auth state change
  const updateSubModuleUsers = (uid: string | null, name: string | null, isReal: boolean): void => {
    updateLBUser(uid);
    updateFriendsUser(uid, name, isReal);
    updateChatUser(uid, name, isReal, getCurrentIcon());
    updateOnlineUser(uid, name, isReal);
    updateLobbyUser(uid, name, isReal);
    updateNotifUser(uid, name, isReal);
    updateSocialAuthButton(isReal);
  };

  initAuthUI({
    navigateTo,
    navigateReset,
    navigateBack,
    showScreen,
    getCurrentScreen: getCurrentScreen as () => string,
    setCurrentScreen,
    updateTimeUserLabel: () => {},
    updateOnlineButton: () => updateOnlineUI(),
    checkLobbyInvite: _checkLobbyInvite,
    checkPendingLobby: _checkPendingLobby,
    checkSavedLobby: _checkSavedLobby,
    startFriendsListeners: _startFriendsListeners,
    stopFriendsListeners: _stopFriendsListeners,
    updateSubModuleUsers,
  });

  // Profile click handlers — open profile overlay for any user in any panel
  setLBProfileClickHandler((uid) => openProfile(uid, navigateTo));
  setFriendProfileClickHandler((uid) => openProfile(uid, navigateTo));
  setLobbyProfileClickHandler((uid) => openProfile(uid, navigateTo));
  setOnlineProfileClickHandler((uid) => openProfile(uid, navigateTo));
}
