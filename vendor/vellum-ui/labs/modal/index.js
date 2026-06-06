import { buttonHtml, el, fieldRowHtml, modal } from '../../index.js';

const mount = document.getElementById('modalLabMount');

const PRESETS = {
  current: {
    label: 'current',
    surface: '#e7e2ee',
    backdrop: 0.4,
    border: 3,
    radius: 0,
    shadow: 8,
    padding: 14,
    close: 'rune',
  },
  softer: {
    label: 'softer',
    surface: '#faf8fd',
    backdrop: 0.28,
    border: 2,
    radius: 8,
    shadow: 4,
    padding: 18,
    close: 'quiet',
  },
  paper: {
    label: 'paper',
    surface: '#fffefb',
    backdrop: 0.22,
    border: 2,
    radius: 3,
    shadow: 0,
    padding: 20,
    close: 'tab',
  },
  compact: {
    label: 'compact',
    surface: '#e7e2ee',
    backdrop: 0.32,
    border: 3,
    radius: 0,
    shadow: 5,
    padding: 10,
    close: 'rune',
  },
};

const state = { ...PRESETS.current };
const controls = {};
let output;
let liveApi;

renderModalLab(mount);

function renderModalLab(target) {
  if (!target) return;
  target.append(header(), shell());
  liveApi = modal(document.getElementById('modalLabLive'));
  applyState();
}

function header() {
  return el(
    'header',
    { className: 'lab-head' },
    el(
      'div',
      {},
      el('h1', { className: 'lab-title', text: 'Modal Lab' }),
      el('p', {
        className: 'lab-sub',
        text: 'A Vellum UI workbench for testing modal weight, paper feel, backdrop, spacing, and close-button treatment.',
      }),
    ),
    el(
      'nav',
      { className: 'lab-head-actions', ariaLabel: 'Vellum UI pages' },
      el('a', { className: 'btn btn-secondary', href: '/vellum-ui/design-system/', text: 'design system' }),
      el('button', { className: 'btn', type: 'button', text: 'open live modal', onClick: () => liveApi.open() }),
    ),
  );
}

function shell() {
  output = el('textarea', { className: 'modal-lab-copy', readOnly: true, rows: 10, spellcheck: false });
  return el(
    'div',
    { className: 'lab-shell' },
    el(
      'aside',
      { className: 'lab-controls' },
      panel('Presets', presetButtons()),
      panel('Knobs', knobControls()),
      panel(
        'Token output',
        el('div', { className: 'lab-control-list' }, output, el('button', { className: 'btn btn-secondary', type: 'button', text: 'copy', onClick: copyOutput })),
      ),
    ),
    el(
      'section',
      { className: 'lab-stage' },
      el(
        'div',
        { className: 'modal-lab-preview-grid' },
        preview('PoolBuilder confirm', poolBuilderModal()),
        preview('Biblioplex editor', biblioplexModal()),
        preview('Long content', longModal()),
        preview('Destructive action', dangerModal()),
      ),
      liveModal(),
    ),
  );
}

function panel(title, body) {
  return el('section', { className: 'lab-panel' }, el('h2', { className: 'lab-panel-title', text: title }), body);
}

function presetButtons() {
  const wrap = el('div', { className: 'segmented', role: 'group', ariaLabel: 'Modal presets' });
  for (const [key, preset] of Object.entries(PRESETS)) {
    const btn = el('button', {
      className: key === 'current' ? 'segment-btn active' : 'segment-btn',
      type: 'button',
      text: preset.label,
      ariaPressed: key === 'current' ? 'true' : 'false',
      onClick: () => {
        Object.assign(state, preset);
        wrap.querySelectorAll('.segment-btn').forEach((other) => {
          const active = other === btn;
          other.classList.toggle('active', active);
          other.setAttribute('aria-pressed', String(active));
        });
        syncControls();
        applyState();
      },
    });
    wrap.append(btn);
  }
  return wrap;
}

function knobControls() {
  const wrap = el('div', { className: 'lab-control-list' });
  controls.surface = colorControl('surface', 'surface', state.surface);
  controls.backdrop = rangeControl('backdrop', 'backdrop', state.backdrop, 0, 0.75, 0.01);
  controls.border = rangeControl('border', 'border', state.border, 0, 6, 1);
  controls.radius = rangeControl('radius', 'radius', state.radius, 0, 16, 1);
  controls.shadow = rangeControl('shadow', 'shadow', state.shadow, 0, 14, 1);
  controls.padding = rangeControl('padding', 'padding', state.padding, 8, 26, 1);
  controls.close = selectControl('close button', 'close', state.close, [
    ['rune', 'rune'],
    ['quiet', 'quiet'],
    ['tab', 'tab'],
  ]);

  for (const control of Object.values(controls)) wrap.append(control.row);
  return wrap;
}

function colorControl(label, key, value) {
  const input = el('input', { type: 'color', value });
  input.addEventListener('input', () => {
    state[key] = input.value;
    applyState();
  });
  return { row: el('label', { className: 'lab-control' }, el('span', { text: label }), input), input };
}

function rangeControl(label, key, value, min, max, step) {
  const readout = el('output', { text: formatRange(key, value) });
  const input = el('input', { type: 'range', value, min, max, step });
  input.addEventListener('input', () => {
    state[key] = Number(input.value);
    readout.textContent = formatRange(key, state[key]);
    applyState();
  });
  return { row: el('label', { className: 'lab-control' }, el('span', { text: label }), readout, input), input, readout };
}

function selectControl(label, key, value, options) {
  const input = el('select');
  for (const [optionValue, optionLabel] of options) input.append(el('option', { value: optionValue, text: optionLabel, selected: optionValue === value }));
  input.addEventListener('change', () => {
    state[key] = input.value;
    applyState();
  });
  return { row: el('label', { className: 'lab-control' }, el('span', { text: label }), input), input };
}

function syncControls() {
  for (const [key, control] of Object.entries(controls)) {
    control.input.value = state[key];
    if (control.readout) control.readout.textContent = formatRange(key, state[key]);
  }
}

function applyState() {
  const root = document.documentElement;
  const values = tokenValues();
  for (const [token, value] of Object.entries(values)) root.style.setProperty(token, value);
  document.body.dataset.closeStyle = state.close;
  output.value = `:root {\n${Object.entries(values)
    .map(([token, value]) => `  ${token}: ${value};`)
    .join('\n')}\n}`;
}

function tokenValues() {
  const borderColor = state.border === 0 ? 'transparent' : 'var(--vui-color-line)';
  return {
    '--vui-modal-backdrop': `rgba(0, 0, 0, ${state.backdrop.toFixed(2)})`,
    '--vui-modal-card-bg': state.surface,
    '--vui-modal-card-border': `${state.border}px solid ${borderColor}`,
    '--vui-modal-card-radius': `${state.radius}px`,
    '--vui-modal-card-shadow': state.shadow === 0 ? '0 0 0 transparent' : `${state.shadow}px ${state.shadow}px 0 var(--vui-color-shadow)`,
    '--vui-modal-head-padding': `${state.padding}px ${state.padding + 2}px`,
    '--vui-modal-body-padding': `${state.padding}px ${state.padding + 2}px`,
    '--vui-modal-actions-padding': `${Math.max(8, state.padding - 2)}px ${state.padding + 2}px`,
  };
}

function formatRange(key, value) {
  if (key === 'backdrop') return value.toFixed(2);
  return `${value}px`;
}

async function copyOutput(event) {
  await navigator.clipboard?.writeText(output.value);
  const btn = event.currentTarget;
  const original = btn.textContent;
  btn.textContent = 'copied';
  window.setTimeout(() => {
    btn.textContent = original;
  }, 900);
}

function preview(label, card) {
  return el('article', { className: 'modal-lab-preview' }, el('div', { className: 'modal-lab-preview-label', text: label }), card);
}

function poolBuilderModal() {
  return modalCard(
    'clear current build?',
    el('p', {
      text: 'This removes 23 cards from your sealed deck. The pool stays intact so you can rebuild from scratch.',
    }),
    [button('cancel', 'secondary'), button('clear deck', 'danger')],
  );
}

function biblioplexModal() {
  return modalCard(
    'edit printing',
    htmlFragment(
      fieldRowHtml({ label: 'card name', controlHtml: '<input type="text" value="Lightning Bolt" />' }) +
        fieldRowHtml({ label: 'location', controlHtml: '<select><option>trade binder</option><option>deckbox</option></select>' }) +
        fieldRowHtml({ label: 'notes', controlHtml: '<textarea rows="3">signed copy</textarea>' }),
      'modal-lab-form',
    ),
    [button('save'), button('cancel', 'secondary')],
  );
}

function longModal() {
  return modalCard(
    'compare expert build',
    el(
      'div',
      { className: 'modal-lab-scroll-body' },
      el('p', { text: 'The reference build is Temur splash-white, prioritizing Lessons and fixing over raw curve density.' }),
      el('p', { text: 'Main differences: it keeps both Pest Mascots, cuts the second Noxious Newt, and treats Prismari Charm as a splash card rather than a lane signal.' }),
      el('p', { text: 'This body intentionally runs long enough to test scrolling, padding, and the visual relationship between the header and action row.' }),
      el('p', { text: 'The lab should make cramped, heavy, or overly theatrical treatments obvious before they land in app code.' }),
    ),
    [button('close', 'secondary'), button('view list')],
  );
}

function dangerModal() {
  return modalCard(
    'delete ghost build?',
    el('p', { text: 'This removes the local comparison record for this pool. Submitted community results are unchanged.' }),
    [button('keep', 'secondary'), button('delete', 'danger')],
  );
}

function liveModal() {
  return el(
    'div',
    { id: 'modalLabLive', className: 'ui-modal modal-lab-live', hidden: true, ariaHidden: 'true' },
    modalCard(
      'live modal',
      el('p', { text: 'This uses the real Vellum modal helper, so escape and close-button behavior are part of the playground.' }),
      [el('button', { className: 'btn btn-secondary', type: 'button', text: 'close', dataset: { modalClose: '' } }), button('commit direction')],
    ),
  );
}

function modalCard(title, body, actions) {
  return el(
    'section',
    { className: 'ui-modal-card' },
    el(
      'header',
      { className: 'ui-modal-head' },
      el('h2', { className: 'ui-modal-title', text: title }),
      el('button', { className: 'rune-close', type: 'button', ariaLabel: 'close', dataset: { modalClose: '' }, text: 'x' }),
    ),
    el('div', { className: 'ui-modal-body' }, body),
    el('footer', { className: 'ui-modal-actions' }, actions),
  );
}

function button(label, variant = 'primary') {
  const template = document.createElement('template');
  template.innerHTML = buttonHtml({ label, variant });
  return template.content.firstElementChild;
}

function htmlFragment(html, className) {
  const wrap = el('div', { className });
  const template = document.createElement('template');
  template.innerHTML = html;
  wrap.append(template.content);
  return wrap;
}
