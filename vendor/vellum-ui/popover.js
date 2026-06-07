import { outsideClick } from './outsideClick.js';

export function popover(triggerEl, panelEl, options = {}) {
  const {
    gap = 4,
    placement = 'bottom-start',
    edgeMargin = 8,
    closeOnOutside = true,
    documentObj = triggerEl?.ownerDocument || document,
  } = options;
  let cleanupOutside = () => {};

  function position() {
    if (!triggerEl || !panelEl) return;
    const win = panelEl.ownerDocument?.defaultView || globalThis;
    const trigger = triggerEl.getBoundingClientRect();
    const panel = panelEl.getBoundingClientRect();
    let left = placement.endsWith('end') ? trigger.right - panel.width : trigger.left;
    let top = placement.startsWith('top') ? trigger.top - panel.height - gap : trigger.bottom + gap;
    left = Math.max(edgeMargin, Math.min(left, win.innerWidth - panel.width - edgeMargin));
    top = Math.max(edgeMargin, Math.min(top, win.innerHeight - panel.height - edgeMargin));
    panelEl.style.left = `${Math.round(left + win.scrollX)}px`;
    panelEl.style.top = `${Math.round(top + win.scrollY)}px`;
  }

  function open() {
    panelEl.hidden = false;
    panelEl.classList.add('open');
    position();
    if (closeOnOutside) cleanupOutside = outsideClick(panelEl, close, { documentObj, ignore: [triggerEl] });
  }

  function close() {
    panelEl.hidden = true;
    panelEl.classList.remove('open');
    cleanupOutside();
    cleanupOutside = () => {};
  }

  function toggle() {
    if (panelEl.hidden || !panelEl.classList.contains('open')) open();
    else close();
  }

  return { open, close, toggle, position };
}
