interface WindowControlsOverlay extends EventTarget {
  readonly visible: boolean;
  getTitlebarAreaRect(): DOMRect;
}

interface Navigator {
  readonly windowControlsOverlay?: WindowControlsOverlay;
}
