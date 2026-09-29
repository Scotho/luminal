import { initLobbyChat as _initChat, destroyLobbyChat as _destroyChat, startDmChat, updateDmOnlineStatuses, reparentChatToSocial } from '../chatUI';
import { onFriendsChange, getFriendOnlineMap } from '../friendsUI';
import type { DisposableBag } from '../../disposables';

export function initLobbyChatIntegration(lobbyId: string): void {
  _initChat(lobbyId);
}

export function destroyLobbyChatIntegration(): void {
  _destroyChat();
}

export function startDm(uid: string, username: string): void {
  startDmChat(uid, username);
}

export function reparentChatToLobby(container: HTMLElement): void {
  reparentChatToSocial(container);
}

/** Wire friends-change callback to keep DM tabs fresh */
// bag parameter reserved for future cleanup; onFriendsChange has no unsubscribe
export function initChatListeners(_bag: DisposableBag): void {
  onFriendsChange(() => {
    updateDmOnlineStatuses(getFriendOnlineMap());
  });
}
