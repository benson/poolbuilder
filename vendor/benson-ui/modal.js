export function modal(modalEl, options = {}) {
  const { closeSelector = '[data-modal-close], .rune-close', openClass = 'open', onClose } = options;
  if (!modalEl) return { open() {}, close() {}, isOpen: () => false };

  const closeButtons = () => [...modalEl.querySelectorAll(closeSelector)];
  const onKeydown = (event) => {
    if (event.key === 'Escape') close();
  };

  function open() {
    modalEl.hidden = false;
    modalEl.classList.add(openClass);
    modalEl.setAttribute('aria-hidden', 'false');
    modalEl.ownerDocument.addEventListener('keydown', onKeydown);
    closeButtons().forEach((button) => button.addEventListener('click', close));
  }

  function close() {
    modalEl.hidden = true;
    modalEl.classList.remove(openClass);
    modalEl.setAttribute('aria-hidden', 'true');
    modalEl.ownerDocument.removeEventListener('keydown', onKeydown);
    closeButtons().forEach((button) => button.removeEventListener('click', close));
    if (typeof onClose === 'function') onClose();
  }

  return { open, close, isOpen: () => !modalEl.hidden };
}
