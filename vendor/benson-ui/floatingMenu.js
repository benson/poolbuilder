export function floatingMenu(triggerEl, menuEl, options = {}) {
  const { openClass = 'open', edgeBuffer = 8, gap = 4 } = options;

  function position() {
    if (!triggerEl || !menuEl) return;
    const trigger = triggerEl.getBoundingClientRect();
    const menu = menuEl.getBoundingClientRect();
    const left = Math.max(edgeBuffer, Math.min(trigger.left, window.innerWidth - menu.width - edgeBuffer));
    const top = Math.max(
      edgeBuffer,
      Math.min(trigger.bottom + gap, window.innerHeight - menu.height - edgeBuffer),
    );
    menuEl.style.left = `${Math.round(left + window.scrollX)}px`;
    menuEl.style.top = `${Math.round(top + window.scrollY)}px`;
  }

  function open() {
    menuEl.hidden = false;
    menuEl.classList.add(openClass);
    position();
  }

  function close() {
    menuEl.hidden = true;
    menuEl.classList.remove(openClass);
  }

  return { open, close, position };
}

export function moveFloatingMenuFocus(menuEl, delta) {
  const items = [...menuEl.querySelectorAll('[role="menuitem"], button, a')]
    .filter((item) => !item.disabled && item.offsetParent !== null);
  if (!items.length) return null;
  const activeIndex = Math.max(0, items.indexOf(menuEl.ownerDocument.activeElement));
  const next = items[(activeIndex + delta + items.length) % items.length];
  next.focus();
  return next;
}
