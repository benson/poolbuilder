export function outsideClick(targetEl, onOutside, options = {}) {
  const {
    documentObj = targetEl?.ownerDocument || document,
    eventName = 'pointerdown',
    ignore = [],
    capture = true,
  } = options;
  if (!targetEl || typeof onOutside !== 'function') return () => {};
  const ignored = Array.isArray(ignore) ? ignore : [ignore];
  const handler = (event) => {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    if (path.includes(targetEl) || targetEl.contains(event.target)) return;
    for (const el of ignored) {
      if (!el) continue;
      if (path.includes(el) || el.contains?.(event.target)) return;
    }
    onOutside(event);
  };
  documentObj.addEventListener(eventName, handler, { capture });
  return () => documentObj.removeEventListener(eventName, handler, { capture });
}
