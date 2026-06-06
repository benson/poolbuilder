import { esc } from './escape.js';
import { el } from './dom.js';

const VALID_TONES = new Set(['neutral', 'success', 'warn', 'danger']);

export function statusStateHtml({ label, tone = 'neutral', icon = '' } = {}) {
  const safeTone = VALID_TONES.has(tone) ? tone : 'neutral';
  const iconHtml = icon ? `<span class="status-state-icon">${esc(icon)}</span>` : '';
  return `<span class="status-state status-state-${safeTone}">${iconHtml}<span class="status-state-label">${esc(label || '')}</span></span>`;
}

export function renderStatusState(targetEl, options = {}) {
  if (!targetEl) return null;
  targetEl.textContent = '';
  const tone = VALID_TONES.has(options.tone) ? options.tone : 'neutral';
  const node = el('span', { className: `status-state status-state-${tone}` });
  if (options.icon) node.append(el('span', { className: 'status-state-icon', text: options.icon }));
  node.append(el('span', { className: 'status-state-label', text: options.label || '' }));
  targetEl.append(node);
  return node;
}
