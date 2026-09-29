declare global {
  interface BeforeInstallPromptEvent extends Event {
    prompt(): Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
  }

  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent;
  }

  interface Window {
    showScreen?: (screen: string | null) => void;
    navigateReset: (screen: string) => void;
    _freeCamLocked?: boolean;
    _hideTopBar?: () => void;
    _showTopBar?: () => void;
    luminalUnlock?: (vehicle: string) => void;
  }
}

export {};
