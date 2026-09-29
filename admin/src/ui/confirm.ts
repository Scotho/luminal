const _pending = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Attach a double-confirmation click handler to a button element.
 * First click shows "CONFIRM?", second click within 3s executes the action.
 */
export function confirmAction(
  btn: HTMLElement,
  originalLabel: string,
  action: () => void | Promise<void>,
): void {
  btn.addEventListener('click', () => {
    const id = btn.id || btn.dataset.action || originalLabel;
    if (_pending.has(id)) {
      clearTimeout(_pending.get(id)!);
      _pending.delete(id);
      btn.classList.remove('confirming');
      btn.classList.add('executing');
      btn.textContent = 'EXECUTING...';
      const result = action();
      if (result instanceof Promise) {
        result
          .then(() => {
            btn.classList.remove('executing');
            btn.classList.add('done');
            btn.textContent = 'DONE';
          })
          .catch(() => {
            btn.classList.remove('executing');
            btn.textContent = 'FAILED';
          })
          .finally(() => {
            setTimeout(() => {
              btn.className = 'purge-btn';
              btn.textContent = originalLabel;
            }, 2000);
          });
      }
    } else {
      btn.textContent = 'CONFIRM?';
      btn.classList.add('confirming');
      const timeout = setTimeout(() => {
        _pending.delete(id);
        btn.textContent = originalLabel;
        btn.classList.remove('confirming');
      }, 3000);
      _pending.set(id, timeout);
    }
  });
}
