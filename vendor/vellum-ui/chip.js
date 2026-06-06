import { attrs, esc } from './escape.js';
import { el } from './dom.js';

export function chipHtml({ label, icon = '', classes = '', removeLabel = '', attrs: extraAttrs = {} } = {}) {
  const className = `chip${classes ? ` ${classes}` : ''}`;
  const iconHtml = icon ? `<span class="chip-icon">${esc(icon)}</span>` : '';
  const removeHtml = removeLabel
    ? `<button class="chip-remove" type="button" aria-label="${esc(removeLabel)}">x</button>`
    : '';
  return `<span class="${className}"${attrs(extraAttrs)}>${iconHtml}<span class="chip-label">${esc(label || '')}</span>${removeHtml}</span>`;
}

export function chipNode({ label, icon = '', classes = '', removeLabel = '', onRemove } = {}) {
  const node = el('span', { className: `chip${classes ? ` ${classes}` : ''}` });
  if (icon) node.append(el('span', { className: 'chip-icon', text: icon }));
  node.append(el('span', { className: 'chip-label', text: label || '' }));
  if (removeLabel) {
    const remove = el('button', {
      className: 'chip-remove',
      type: 'button',
      ariaLabel: removeLabel,
      text: 'x',
      onClick: onRemove,
    });
    node.append(remove);
  }
  return node;
}
