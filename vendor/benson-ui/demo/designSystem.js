import {
  buttonHtml,
  chipNode,
  clearNode,
  el,
  fieldRowHtml,
  renderStatusState,
  statusStateHtml,
} from '../index.js';

const mount = document.getElementById('designSystemMount');

const COLOR_TOKENS = [
  '--color-bg',
  '--color-surface',
  '--color-surface-sunken',
  '--color-surface-raised',
  '--color-text',
  '--color-text-muted',
  '--color-accent',
  '--color-accent-soft',
  '--color-danger',
  '--color-warn',
];

const SIZE_TOKENS = [
  '--border-width',
  '--radius-sharp',
  '--radius-soft',
  '--shadow-firm',
  '--shadow-hard',
  '--font-size-sm',
  '--font-size-md',
  '--font-size-jumbo',
];

renderDesignSystem(mount);

export function renderDesignSystem(target) {
  if (!target) return;
  clearNode(target);
  const content = el('div', { className: 'ds-page-body' });
  const groups = [
    tokensGroup(),
    buttonsGroup(),
    formsGroup(),
    statusGroup(),
    overlaysGroup(),
  ];
  for (const groupNode of groups) content.append(groupNode);
  target.append(
    pageHeader(),
    el(
      'div',
      { className: 'ds-page-layout' },
      toc(groups.map((groupNode) => ({ id: groupNode.id, title: groupNode.dataset.title }))),
      content,
    ),
  );
  wireToc(target);
}

function pageHeader() {
  return el(
    'header',
    { className: 'ds-page-head' },
    el('h1', { className: 'ds-page-title', text: 'Benson UI' }),
    el('p', {
      className: 'ds-page-sub',
      text:
        'Shared tokens, hard-shadow primitives, and small browser-native helpers for Biblioplex, Pool Builder, and future apps.',
    }),
    el('a', { className: 'ds-page-back', href: './design-system.html', text: 'home' }),
  );
}

function toc(groups) {
  const wrap = el('aside', { className: 'ds-toc' });
  wrap.append(
    el('div', { className: 'ds-toc-title', text: 'states' }),
    el(
      'div',
      { className: 'ds-toc-states' },
      el(
        'div',
        { className: 'ds-toc-state-row' },
        stateButton('rest', () => setDemoState('rest')),
        stateButton('hover', () => setDemoState('hover')),
        stateButton('focus', () => setDemoState('focus')),
      ),
    ),
    el('div', { className: 'ds-toc-title', text: 'catalog' }),
  );
  for (const group of groups) wrap.append(el('a', { className: 'ds-toc-link', href: `#${group.id}`, text: group.title }));
  return wrap;
}

function stateButton(label, onClick) {
  return el('button', { className: label === 'rest' ? 'ds-toc-state-btn active' : 'ds-toc-state-btn', type: 'button', text: label, onClick });
}

function setDemoState(state) {
  document.querySelectorAll('.ds-toc-state-btn').forEach((btn) => btn.classList.toggle('active', btn.textContent === state));
  document.body.classList.toggle('ds-force-hover', state === 'hover');
  document.body.classList.toggle('ds-force-focus', state === 'focus');
}

function wireToc(target) {
  const links = [...target.querySelectorAll('.ds-toc-link')];
  const groups = links.map((link) => document.querySelector(link.getAttribute('href'))).filter(Boolean);
  const setActive = () => {
    const current = groups.findLast((group) => group.getBoundingClientRect().top <= 96) || groups[0];
    links.forEach((link) => link.classList.toggle('active', link.getAttribute('href') === `#${current?.id}`));
  };
  document.addEventListener('scroll', setActive, { passive: true });
  setActive();
}

function group(id, title, ...entries) {
  const wrap = el('section', { id, className: 'ds-group', dataset: { title } });
  wrap.append(el('h2', { className: 'ds-group-title', text: title }), ...entries);
  return wrap;
}

function entry(name, selectors, description, demoFactory) {
  const demo = el('div', { className: 'ds-entry-demo' });
  const stage = el('div', { className: 'ds-zoom-stage' });
  const built = demoFactory();
  if (built) stage.append(built);
  demo.append(zoomBar(stage), stage);
  return el(
    'section',
    { className: 'ds-entry' },
    el(
      'header',
      { className: 'ds-entry-head' },
      el('h3', { className: 'ds-entry-name', text: name }),
      el('div', { className: 'ds-entry-selectors' }, selectors.map((selector) => el('code', { text: selector }))),
    ),
    el('p', { className: 'ds-entry-desc', text: description }),
    demo,
  );
}

function zoomBar(stage) {
  const bar = el('div', { className: 'ds-zoom-bar' });
  for (const zoom of [1, 2, 3]) {
    const btn = el('button', {
      className: zoom === 1 ? 'ds-zoom-btn active' : 'ds-zoom-btn',
      type: 'button',
      text: `${zoom}x`,
      onClick: () => {
        stage.style.zoom = zoom === 1 ? '' : String(zoom);
        bar.querySelectorAll('.ds-zoom-btn').forEach((other) => other.classList.toggle('active', other === btn));
      },
    });
    bar.append(btn);
  }
  return bar;
}

function tokensGroup() {
  return group(
    'tokens',
    'Tokens',
    entry(
      'Token playground',
      [':root', '--color-*', '--radius-*', '--shadow-*'],
      'Tune core CSS variables live. This page updates immediately; copy the generated override back into src/css/tokens.css when a direction feels right.',
      tokenPlayground,
    ),
  );
}

function tokenPlayground() {
  const output = el('pre', { className: 'ds-token-output' });
  const playground = el('div', { className: 'ds-playground' });
  const colorCol = tokenColumn('color', COLOR_TOKENS, 'color');
  const sizeCol = tokenColumn('size', SIZE_TOKENS, 'text');
  playground.append(colorCol, sizeCol, el('div', { className: 'ds-playground-col' }, el('div', { className: 'ds-playground-col-label', text: 'override' }), output));

  const updateOutput = () => {
    const overrides = [...playground.querySelectorAll('[data-token]')]
      .map((input) => `  ${input.dataset.token}: ${input.value};`)
      .join('\n');
    output.textContent = `:root {\n${overrides}\n}`;
  };
  playground.querySelectorAll('[data-token]').forEach((input) => {
    input.addEventListener('input', () => {
      document.documentElement.style.setProperty(input.dataset.token, input.value);
      updateOutput();
    });
  });
  updateOutput();
  return playground;
}

function tokenColumn(label, tokens, type) {
  const col = el('div', { className: 'ds-playground-col' }, el('div', { className: 'ds-playground-col-label', text: label }));
  const computed = getComputedStyle(document.documentElement);
  for (const token of tokens) {
    const value = computed.getPropertyValue(token).trim();
    const input = el('input', {
      className: type === 'text' ? 'ds-playground-text' : '',
      type,
      value: type === 'color' ? normalizeColor(value) : value,
      dataset: { token },
    });
    col.append(el('label', { className: 'ds-playground-row' }, el('span', { className: 'ds-playground-token', text: token }), input));
  }
  return col;
}

function normalizeColor(value) {
  if (/^#[0-9a-f]{6}$/i.test(value)) return value;
  const probe = document.createElement('span');
  probe.style.color = value;
  document.body.append(probe);
  const rgb = getComputedStyle(probe).color.match(/\d+/g)?.slice(0, 3).map(Number) || [0, 0, 0];
  probe.remove();
  return '#' + rgb.map((part) => part.toString(16).padStart(2, '0')).join('');
}

function buttonsGroup() {
  return group(
    'buttons',
    'Buttons',
    entry('Buttons', ['.btn', '.btn-secondary', '.btn-danger', '.btn-ink', '.btn-link'], 'Primary gold, secondary blue, danger red, ink, disabled, and bare text actions.', () =>
      demoHtml(
        buttonHtml({ label: 'reload' }) +
          buttonHtml({ label: 'save' }) +
          buttonHtml({ label: 'cancel', variant: 'secondary' }) +
          buttonHtml({ label: 'delete', variant: 'danger' }) +
          buttonHtml({ label: 'generate', variant: 'ink' }) +
          buttonHtml({ label: 'disabled', attrs: { disabled: true } }) +
          '<button class="btn-link" type="button">inline action</button>',
      ),
    ),
    entry('Segmented control', ['.segmented', '.segment-btn'], 'Hard-shadow abutting segments. Active segments press into the canvas.', segmentedDemo),
    entry('Icon buttons', ['.icon-btn'], 'Bare glyph buttons for compact table/card actions.', () =>
      demoHtml(
        '<button class="icon-btn" type="button" aria-label="close">x</button>' +
          '<button class="icon-btn" type="button" aria-label="more">...</button>' +
          '<button class="icon-btn" type="button" aria-label="refresh">r</button>',
      ),
    ),
  );
}

function segmentedDemo() {
  const wrap = el('div', { className: 'segmented', role: 'group' });
  for (const [i, label] of ['daily', 'sealed', 'archive'].entries()) {
    wrap.append(
      el('button', {
        className: i === 0 ? 'segment-btn active' : 'segment-btn',
        type: 'button',
        text: label,
        ariaPressed: i === 0 ? 'true' : 'false',
        onClick: () => {
          wrap.querySelectorAll('.segment-btn').forEach((btn) => {
            const active = btn.textContent === label;
            btn.classList.toggle('active', active);
            btn.setAttribute('aria-pressed', String(active));
          });
        },
      }),
    );
  }
  return wrap;
}

function formsGroup() {
  return group(
    'forms',
    'Forms',
    entry('Fields', ['input', 'select', 'textarea', '.field-row'], 'Carved vellum fields with mono type and inset shadow.', () =>
      demoHtml(
        fieldRowHtml({
          label: 'card name',
          controlHtml: '<input type="text" value="Lightning Bolt" />',
        }) +
          fieldRowHtml({
            label: 'format',
            controlHtml: '<select><option>sealed</option><option>draft</option></select>',
          }) +
          fieldRowHtml({
            label: 'notes',
            controlHtml: '<textarea rows="3" placeholder="notes"></textarea>',
          }),
      ),
    ),
  );
}

function statusGroup() {
  return group(
    'status',
    'Status',
    entry('Status states', ['.status-state'], 'Compact feedback chips for neutral, success, warning, and danger states.', () => {
      const row = demoHtml(
        statusStateHtml({ label: 'ready', tone: 'success' }) +
          statusStateHtml({ label: 'waiting', tone: 'warn' }) +
          statusStateHtml({ label: 'error', tone: 'danger' }) +
          statusStateHtml({ label: 'idle' }),
      );
      const mount = el('span');
      renderStatusState(mount, { label: 'rendered by JS', tone: 'success' });
      row.append(mount);
      return row;
    }),
    entry('Banner', ['.banner', '.banner-message', '.banner-actions', '.banner-dismiss'], 'Full-width inline banner with a message, CTA, and right-aligned dismiss control.', () => {
      const banner = el('div', { className: 'banner', role: 'status' });
      banner.append(
        el('span', { className: 'banner-message', text: 'site updated \u00b7 reload to see the latest' }),
        el('div', { className: 'banner-actions' }, el('button', { className: 'btn', type: 'button', text: 'reload' })),
        el('button', { className: 'icon-btn banner-dismiss', type: 'button', ariaLabel: 'dismiss', text: 'x' }),
      );
      return banner;
    }),
    entry('Chips', ['.chip'], 'Small labeled objects for filters, tags, and state markers.', () => {
      const row = el('div', { className: 'ds-row' });
      row.append(
        chipNode({ label: 'Boros', icon: 'WR' }),
        chipNode({ label: 'submitted', icon: '*' }),
        chipNode({ label: 'splash', removeLabel: 'remove splash' }),
      );
      return row;
    }),
  );
}

function overlaysGroup() {
  return group(
    'overlays',
    'Overlays',
    entry('Modal frame', ['.ui-modal-card', '.ui-modal-head', '.ui-modal-body', '.rune-close'], 'Canonical modal card with floating rune close button.', () =>
      el(
        'section',
        { className: 'ui-modal-card', style: { width: 'min(520px, 100%)' } },
        el(
          'header',
          { className: 'ui-modal-head' },
          el('h3', { className: 'ui-modal-title', text: 'reference build' }),
          el('button', { className: 'rune-close', type: 'button', ariaLabel: 'close', text: 'x' }),
        ),
        el('div', { className: 'ui-modal-body', text: 'A framed modal body for app-specific content.' }),
        el('footer', { className: 'ui-modal-actions' }, el('button', { className: 'btn', type: 'button', text: 'done' })),
      ),
    ),
    entry('Popover frame', ['.ui-popover', '.floating-menu'], 'Anchored floating surface and menu item vocabulary.', () =>
      el(
        'div',
        { className: 'ds-static-popover' },
        el(
          'div',
          { className: 'ds-static-popover-body floating-menu' },
          el('button', { className: 'floating-menu-item', type: 'button', text: 'move to deck' }),
          el('button', { className: 'floating-menu-item is-active', type: 'button', text: 'compare build' }),
          el('button', { className: 'floating-menu-item', type: 'button', text: 'remove' }),
        ),
      ),
    ),
  );
}

function demoHtml(html) {
  const row = el('div', { className: 'ds-row' });
  const template = document.createElement('template');
  template.innerHTML = html;
  row.append(template.content);
  return row;
}
