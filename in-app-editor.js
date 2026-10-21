/* In-App Editor · MIT */
(function () {
  'use strict';
  if (typeof window === 'undefined' || window.InAppEditor) return;
  const script = document.currentScript;
  const excluded = 'script,style,link,meta,head,title,noscript,template,in-app-editor';
  const noText = 'input,textarea,select,img,iframe,video,audio,canvas,svg,path,br,hr';
  const inherited = new Set(['color', 'font-family', 'font-size', 'font-style', 'font-weight', 'font-stretch', 'font-variant', 'line-height', 'letter-spacing', 'word-spacing', 'text-align', 'text-transform', 'text-indent', 'visibility', 'direction', '-webkit-text-fill-color']);
  let state, readyHandler;
  const icons = {
    select: '<path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M4 11v2M11 4h2M20 11v2M11 20h2"/>', move: '<path d="m12 2 3 3M12 2 9 5M12 2v20m0 0 3-3m-3 3-3-3M2 12l3-3m-3 3 3 3M2 12h20m0 0-3-3m3 3-3 3"/>', pan: '<path d="M8 13V5a2 2 0 0 1 4 0v7-9a2 2 0 0 1 4 0v9-6a2 2 0 0 1 4 0v9c0 5-3 7-7 7-3 0-5-2-7-5l-3-4a2 2 0 0 1 3-3l2 3"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>', undo: '<path d="M9 5 4 10l5 5M4 10h10a6 6 0 0 1 0 12"/>', redo: '<path d="m15 5 5 5-5 5M20 10H10a6 6 0 0 0 0 12"/>',
    delete: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>', group: '<rect x="3" y="3" width="12" height="12" rx="1"/><rect x="9" y="9" width="12" height="12" rx="1"/>', ungroup: '<path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5"/><rect x="8" y="8" width="8" height="8"/>', side: '<path d="M8 3H4v18h4M16 3h4v18h-4M11 7l-4 5 4 5M13 7l4 5-4 5"/>', scale: '<path d="M8 16 17 7M8 7h9v9"/>'
  };
  function icon(name) { return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + icons[name] + '</svg>'; }
  function escapeHTML(value) { return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
  function sourceOf(element) { return state?.sources.get(element) || element; }
  function copyOf(element) { return state?.copies.get(element) || element; }
  function editable(element) { return element instanceof Element && state.sources.has(element) && !element.matches(excluded) && Boolean(element.style); }
  function textAllowed(element) { return editable(element) && (state.textItems?.has(element) || (layerFor(element)?.plan.textual && element.childElementCount === 0)) && !element.matches(noText); }
  function selectorFor(element) {
    const key = state?.keys?.get(element);
    if (key) return key;
    element = sourceOf(element);
    const sourceKey = state?.sourceKeys?.get(element);
    if (sourceKey) return sourceKey;
    if (element.nodeType === Node.TEXT_NODE) return selectorFor(element.parentElement) + '::text(' + [...element.parentNode.childNodes].indexOf(element) + ')';
    if (element.id && document.querySelectorAll('#' + CSS.escape(element.id)).length === 1) return '#' + CSS.escape(element.id);
    for (const name of ['data-testid', 'data-edit-id']) {
      if (!element.hasAttribute(name)) continue;
      const selector = '[' + name + '="' + CSS.escape(element.getAttribute(name)) + '"]';
      if (document.querySelectorAll(selector).length === 1) return selector;
    }
    const parts = [];
    while (element && element !== document.documentElement) {
      if (element.id && document.querySelectorAll('#' + CSS.escape(element.id)).length === 1) { parts.unshift('#' + CSS.escape(element.id)); break; }
      const siblings = element.parentElement ? [...element.parentElement.children].filter((item) => item.localName === element.localName) : [];
      parts.unshift(CSS.escape(element.localName) + (siblings.length > 1 ? ':nth-of-type(' + (siblings.indexOf(element) + 1) + ')' : ''));
      element = element.parentElement;
    }
    return parts.join(' > ');
  }
  function find(record) { return state.elementsByKey.get(record.selector) || null; }
  // Read the source page once. All edits use these copies.
  function capturePage() {
    const workspace = state.root.querySelector('[data-workspace]'), stage = state.root.querySelector('[data-stage]');
    state.sourceKeys = new WeakMap(); state.keys = new WeakMap(); state.sources = new WeakMap(); state.copies = new WeakMap(); state.layers = new Map(); state.sourceById = new Map(); state.recordIds = new Map(); state.selected = state.hovered = null; state.selection.clear(); state.canvas.replaceChildren();
    const width = Math.max(document.documentElement.scrollWidth, window.innerWidth), height = Math.max(document.documentElement.scrollHeight, window.innerHeight);
    const scale = Math.max(.1, Math.min(4, Number(state.options.initialZoom) || .8));
    state.page = { width, height }; state.view = { x: innerWidth * (1 - scale) / 2 - window.scrollX * scale, y: innerHeight * (1 - scale) / 2 - window.scrollY * scale, scale };
    Object.assign(stage.style, { width: width + 'px', height: height + 'px' });
    const pageCSS = getComputedStyle(document.documentElement);
    workspace.style.colorScheme = pageCSS.colorScheme;
    const bodyBackground = getComputedStyle(document.body).backgroundColor;
    stage.style.background = pageCSS.backgroundColor === 'rgba(0, 0, 0, 0)' ? (bodyBackground === 'rgba(0, 0, 0, 0)' ? 'Canvas' : bodyBackground) : pageCSS.background;
    let serial = 0;
    const pseudoRules = [];
    const nativeHost = document.createElement('div'); nativeHost.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden;';
    const nativeRoot = nativeHost.attachShadow({ mode: 'open' }); state.root.append(nativeHost);
    const nativeDefaults = new Map();
    function declarations(css, source) {
      let defaults;
      if (source?.matches('button,input,select,textarea')) {
        const key = source.localName + ':' + source.type + ':' + css.colorScheme + ':' + source.disabled;
        defaults = nativeDefaults.get(key);
        if (!defaults) {
          const control = document.createElement(source.localName);
          if (source.matches('input,button')) control.type = source.type;
          if (source.matches('select')) control.multiple = source.multiple;
          control.disabled = source.disabled; control.style.colorScheme = css.colorScheme;
          nativeRoot.append(control); const base = getComputedStyle(control);
          defaults = Object.fromEntries([...base].map((property) => [property, base.getPropertyValue(property)]));
          nativeDefaults.set(key, defaults); control.remove();
        }
      }
      return [...css].filter((key) => !defaults || !/^(border|background|box-shadow|appearance|-webkit-appearance)/.test(key) || css.getPropertyValue(key) !== defaults[key]).map((key) => key + ':' + css.getPropertyValue(key) + ';').join('');
    }
    function copyNode(source) {
      if (source.nodeType === Node.TEXT_NODE) { const copy = document.createTextNode(source.textContent); state.copies.set(source, copy); return copy; }
      if (source.nodeType === Node.COMMENT_NODE) return document.createComment(source.textContent);
      if (!(source instanceof Element) || source.matches(excluded)) return document.createComment('');
      const css = getComputedStyle(source);
      const element = source.localName.includes('-') ? document.createElement('div') : source.cloneNode(false);
      if (source.localName.includes('-')) for (const attribute of source.attributes) element.setAttribute(attribute.name, attribute.value);
      for (const attribute of [...element.attributes]) if (/^on/i.test(attribute.name) || ['autofocus', 'contenteditable', 'srcdoc'].includes(attribute.name)) element.removeAttribute(attribute.name);
      if (element.localName === 'iframe') { element.removeAttribute('src'); element.setAttribute('sandbox', ''); }
      element.style.cssText = declarations(css, source) + source.style.cssText;
      element.style.removeProperty('-webkit-user-modify');
      if (source !== document.body && source.parentElement) {
        const parent = getComputedStyle(source.parentElement);
        for (const property of inherited) if (css.getPropertyValue(property) === parent.getPropertyValue(property)) element.style.removeProperty(property);
      }
      if (css.getPropertyValue('-webkit-text-fill-color') === css.color) element.style.removeProperty('-webkit-text-fill-color');
      element.style.setProperty('animation', 'none', 'important'); element.style.setProperty('transition', 'none', 'important'); element.style.setProperty('pointer-events', 'auto', 'important'); element.style.removeProperty('cursor');
      const id = String(++serial); element.setAttribute('data-iae-node', id); state.keys.set(element, selectorFor(source)); state.sourceKeys.set(source, selectorFor(source)); state.sources.set(element, source); state.copies.set(source, element); state.sourceById.set(id, source);
      for (const name of ['::before', '::after']) { const pseudo = getComputedStyle(source, name); if (pseudo.content && !['none', 'normal'].includes(pseudo.content)) pseudoRules.push('[data-iae-node="' + id + '"]' + name + '{' + declarations(pseudo) + '}'); }
      for (const child of source.childNodes) { const copy = copyNode(child); if (copy) element.append(copy); }
      if (source instanceof HTMLInputElement) { element.value = source.value; element.checked = source.checked; }
      if (source instanceof HTMLTextAreaElement) element.value = source.value;
      if (source instanceof HTMLSelectElement) element.selectedIndex = source.selectedIndex;
      if (source instanceof HTMLCanvasElement) { try { element.getContext('2d')?.drawImage(source, 0, 0); } catch {} }
      if (source instanceof HTMLVideoElement) { element.autoplay = false; element.muted = true; element.pause(); }
      return element;
    }
    const body = copyNode(document.body), css = document.createElement('style'); nativeHost.remove();
    body.style.setProperty('isolation', 'isolate', 'important');
    css.textContent = ':host{display:flow-root;position:relative;min-height:inherit}*{cursor:grab!important;user-select:none!important}[contenteditable]{cursor:text!important;user-select:text!important}' + pseudoRules.join('');
    state.plans = []; state.matrices = new WeakMap(); itemPlan(document.body, null); state.planKeys = new Map(state.plans.map(plan => [plan.id, plan.key]));
    state.template = body.cloneNode(true); copyValues(body, state.template); state.snapshotCSS = css.cloneNode(true);
    state.canvas.append(css, body); workspace.hidden = false; drawView(); workspace.focus({ preventScroll: true });
    prepareItems();
    for (const record of state.changes.values()) applyRecord(record);
  }
  function copyValues(from, to) {
    const before = [from, ...from.querySelectorAll('*')], after = [to, ...to.querySelectorAll('*')];
    before.forEach((element, index) => {
      const copy = after[index];
      if (element instanceof HTMLInputElement) { copy.value = element.value; copy.checked = element.checked; }
      if (element instanceof HTMLTextAreaElement) copy.value = element.value;
      if (element instanceof HTMLSelectElement) copy.selectedIndex = element.selectedIndex;
      if (element instanceof HTMLCanvasElement) { try { copy.getContext('2d')?.drawImage(element, 0, 0); } catch {} }
    });
  }
  function rebuildCopy() {
    if (!state.template) return;
    const selected = [...state.selection].map(sourceOf), body = state.template.cloneNode(true);
    copyValues(state.template, body); state.keys = new WeakMap(); state.sources = new WeakMap(); state.copies = new WeakMap(); state.layers = new Map(); state.selected = state.hovered = null; state.lastTap = null;
    for (const element of [body, ...body.querySelectorAll('[data-iae-node]')]) {
      const source = state.sourceById.get(element.getAttribute('data-iae-node'));
      if (source) { state.sources.set(element, source); state.copies.set(source, element); }
    }
    state.canvas.replaceChildren(state.snapshotCSS.cloneNode(true), body);
    prepareItems();
    for (const record of state.changes.values()) applyRecord(record);
    selectItems(selected.map(copyOf).filter((element) => layerFor(element) && !layerFor(element).deleted));
  }
  function pageRect(element) {
    const rect = element.getBoundingClientRect(), view = state.view;
    return { x: (rect.left - view.x) / view.scale, y: (rect.top - view.y) / view.scale, width: rect.width / view.scale, height: rect.height / view.scale };
  }
  function matrixFor(element) {
    if (!element) return new DOMMatrix();
    if (state.matrices.has(element)) return state.matrices.get(element);
    let own = new DOMMatrix(getComputedStyle(element).transform === 'none' ? undefined : getComputedStyle(element).transform);
    try { own = element.computedStyleMap().get('transform').toMatrix(); } catch {}
    const matrix = matrixFor(element.parentElement).multiply(own);
    matrix.e = matrix.f = 0;
    state.matrices.set(element, matrix);
    return matrix;
  }
  function paintInfo(source, css, parentPlan) {
    const parent = source.parentElement && getComputedStyle(source.parentElement), positioned = css.position !== 'static';
    const context = source === document.body || css.opacity !== '1' || css.transform !== 'none' || css.filter !== 'none' || css.isolation === 'isolate' || ['fixed', 'sticky'].includes(css.position) || (css.zIndex !== 'auto' && (positioned || /flex|grid/.test(parent?.display)));
    const raised = positioned || Boolean(parentPlan && !parentPlan.paint.context && parentPlan.paint.raised);
    let phase = raised ? 5 : 2;
    if (css.float !== 'none') phase = Math.max(phase, 3);
    if (css.display.startsWith('inline')) phase = Math.max(phase, 4);
    const z = Number(css.zIndex) || 0;
    if (context) phase = z < 0 ? 1 : z > 0 ? 6 : 5;
    return { context, phase, z, raised };
  }
  function clipInfo(source) {
    const clips = []; let opacity = 1;
    for (let node = source.parentElement; node && node !== document.documentElement; node = node.parentElement) {
      const css = getComputedStyle(node); opacity *= Number(css.opacity);
      if (!/(hidden|clip|scroll|auto)/.test(css.overflowX + css.overflowY)) continue;
      const rect = node.getBoundingClientRect(), left = rect.left + window.scrollX + parseFloat(css.borderLeftWidth), top = rect.top + window.scrollY + parseFloat(css.borderTopWidth);
      const right = rect.right + window.scrollX - parseFloat(css.borderRightWidth), bottom = rect.bottom + window.scrollY - parseFloat(css.borderBottomWidth);
      const radius = ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius'].map((key) => Math.max(0, parseFloat(css.getPropertyValue(key)) - parseFloat(css.borderLeftWidth)) + 'px').join(' ');
      clips.push({ left, top, right, bottom, radius });
    }
    return { clips, opacity };
  }
  function itemPlan(source, parent) {
    if (source.matches(excluded) || !source.getClientRects().length) return;
    const element = state.copies.get(source), css = getComputedStyle(source);
    if (!element || !element.style) return;
    const children = [...source.children].filter((child) => !child.matches(excluded) && child.getClientRects().length);
    const atomic = source !== document.body && (source.matches('svg,img,canvas,video,audio,iframe,input,textarea,select,button') || !children.length);
    const rect = source.getBoundingClientRect();
    const matrix = matrixFor(source), a = Math.abs(matrix.a), b = Math.abs(matrix.b), c = Math.abs(matrix.c), d = Math.abs(matrix.d), determinant = a * d - b * c;
    const borderWidth = Math.abs(determinant) > 1e-6 ? (rect.width * d - rect.height * c) / determinant : source.offsetWidth || rect.width;
    const borderHeight = Math.abs(determinant) > 1e-6 ? (rect.height * a - rect.width * b) / determinant : source.offsetHeight || rect.height;
    const plan = { id: element.getAttribute('data-iae-node'), key: selectorFor(source), parent: parent?.id || null, atomic,
      rect: { x: rect.x + window.scrollX, y: rect.y + window.scrollY, width: rect.width, height: rect.height },
      width: atomic ? css.width : Math.round(borderWidth * 64) / 64 + 'px', height: atomic ? css.height : Math.round(borderHeight * 64) / 64 + 'px', display: css.display, textual: atomic && Boolean(source.textContent.trim()),
      inherited: Object.fromEntries([...inherited].map((key) => [key, css.getPropertyValue(key)])),
      matrix, parentMatrix: parent ? parent.matrix : new DOMMatrix(), paint: paintInfo(source, css, parent), ...clipInfo(source),
      selectable: source !== document.body && (atomic || css.backgroundColor !== 'rgba(0, 0, 0, 0)' || css.backgroundImage !== 'none' || css.boxShadow !== 'none' || ['Top', 'Right', 'Bottom', 'Left'].some((side) => parseFloat(css['border' + side + 'Width']) > 0)) };
    state.plans.push(plan);
    if (atomic) return;
    for (const node of source.childNodes) {
      if (node instanceof Element) itemPlan(node, plan);
      else if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) textPlan(node, plan);
    }
  }
  function textPlan(source, parent) {
    const range = document.createRange(), rows = [];
    let row;
    for (let index = 0; index < source.length; index++) {
      range.setStart(source, index); range.setEnd(source, index + 1);
      const rect = range.getBoundingClientRect();
      if (!rect.width && !/\p{Mark}/u.test(source.textContent[index])) continue;
      if (!row || Math.abs(rect.y - row.top) > .5) {
        row = { text: '', x: rect.x + window.scrollX, y: rect.y + window.scrollY, top: rect.y, width: 0, height: rect.height };
        rows.push(row);
      }
      row.text += source.textContent[index];
      row.width = Math.max(row.width, rect.right + window.scrollX - row.x);
    }
    if (!rows.length) return;
    const id = 't' + state.plans.length, index = [...source.parentNode.childNodes].indexOf(source), key = parent.key + '::text(' + index + ')';
    const rect = { x: Math.min(...rows.map((item) => item.x)), y: Math.min(...rows.map((item) => item.y)) };
    rect.width = Math.max(...rows.map((item) => item.x + item.width)) - rect.x;
    rect.height = Math.max(...rows.map((item) => item.y + item.height)) - rect.y;
    state.sourceById.set(id, source); state.sourceKeys.set(source, key);
    state.plans.push({ id, key, parent: parent.id, atomic: true, text: source.textContent, rows, rect, matrix: parent.matrix, parentMatrix: parent.matrix,
      inherited: parent.inherited, width: rect.width + 'px', height: rect.height + 'px', display: 'block', paint: { context: false, phase: parent.paint.context ? 4 : Math.max(4, parent.paint.phase), z: 0 }, selectable: true, ...clipInfo(source) });
  }
  function prepareItems() {
    state.owners = new WeakMap(); state.itemElements = new WeakMap(); state.textItems = new WeakMap(); state.elementsByKey = new Map();
    const elements = new Map();
    for (const plan of state.plans) {
      let element;
      if (plan.text !== undefined) {
        element = document.createElement('div');
        element.setAttribute('data-iae-node', plan.id);
        element.style.cssText = 'padding:0;border:0;background:none;white-space:pre-wrap;';
        for (const row of plan.rows) {
          const span = document.createElement('span');
          span.style.cssText = 'position:absolute;left:0;top:0;white-space:pre;';
          span.textContent = row.text; element.append(span);
        }
        const source = state.sourceById.get(plan.id);
        state.sources.set(element, source); state.copies.set(source, element); state.textItems.set(element, { value: plan.text });
      } else element = state.copies.get(state.sourceById.get(plan.id));
      elements.set(plan.id, element);
    }
    // Remove layout children before any item is placed on the canvas.
    for (const plan of state.plans) {
      const element = elements.get(plan.id);
      if (element.parentNode) element.remove();
      if (!plan.atomic) for (const node of [...element.childNodes]) if (node.nodeType === Node.TEXT_NODE) node.remove();
    }
    state.canvas.replaceChildren(state.snapshotCSS.cloneNode(true));
    const contexts = new Map(), rootContext = { children: [] };
    for (const plan of state.plans) {
      const parentContext = contexts.get(plan.parent) || rootContext, node = { plan, children: [] };
      parentContext.children.push(node); contexts.set(plan.id, plan.paint.context ? node : parentContext);
    }
    let order = 0;
    function paint(context) {
      context.children.sort((a, b) => a.plan.paint.phase - b.plan.paint.phase || a.plan.paint.z - b.plan.paint.z);
      for (const node of context.children) { node.plan.order = ++order; paint(node); }
    }
    paint(rootContext);
    for (const plan of state.plans) {
      const element = elements.get(plan.id), source = state.sourceById.get(plan.id);
      const wrapper = document.createElement('div');
      wrapper.setAttribute('data-iae-layer', plan.key);
      wrapper.style.cssText = 'position:absolute;left:0;top:0;margin:0;padding:0;border:0;font-size:0;line-height:0;transform-origin:0 0;pointer-events:none;';
      for (const [key, value] of Object.entries(plan.inherited)) element.style.setProperty(key, key === '-webkit-text-fill-color' && value === plan.inherited.color ? 'currentcolor' : value);
      element.style.setProperty('position', 'relative', 'important'); element.style.setProperty('inset', 'auto', 'important');
      element.style.setProperty('margin', '0', 'important'); element.style.setProperty('flex', 'none', 'important');
      element.style.setProperty('width', plan.width, 'important'); element.style.setProperty('height', plan.height, 'important');
      if (!plan.atomic) { element.style.setProperty('display', 'block', 'important'); element.style.setProperty('box-sizing', 'border-box', 'important'); }
      element.style.setProperty('transform-origin', '0 0', 'important');
      element.style.setProperty('transform', 'matrix(' + [plan.matrix.a, plan.matrix.b, plan.matrix.c, plan.matrix.d, 0, 0].join(',') + ')', 'important');
      element.style.setProperty('opacity', String(Number(element.style.opacity || 1) * plan.opacity), 'important');
      element.style.setProperty('pointer-events', plan.selectable ? 'auto' : 'none', 'important');
      wrapper.style.zIndex = String(plan.order);
      wrapper.append(element);
      let outer = wrapper;
      for (const clip of plan.clips) {
        const shell = document.createElement('div'); shell.dataset.iaeClip = '';
        shell.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:' + plan.order + ';clip-path:inset(' + clip.top + 'px ' + (state.page.width - clip.right) + 'px ' + (state.page.height - clip.bottom) + 'px ' + clip.left + 'px round ' + clip.radius + ');';
        shell.append(outer); outer = shell;
      }
      state.canvas.append(outer);
      const layer = { element, wrapper, outer, source, parent: null, plan, x: plan.rect.x, y: plan.rect.y, scale: 1, localX: 0, localY: 0, group: null, deleted: false };
      state.layers.set(plan.key, layer); state.itemElements.set(element, layer);
      state.elementsByKey.set(plan.key, element); state.keys.set(element, plan.key);
      state.owners.set(element, element);
      if (plan.atomic) for (const child of element.querySelectorAll('*')) state.owners.set(child, element);
      drawLayer(layer);
      if (plan.text !== undefined) {
        [...element.children].forEach((span, index) => {
          const range = document.createRange(); range.selectNodeContents(span);
          const actual = range.getBoundingClientRect(), row = plan.rows[index];
          const delta = plan.parentMatrix.inverse().transformPoint(new DOMPoint((row.x - (actual.x - state.view.x) / state.view.scale), (row.y - (actual.y - state.view.y) / state.view.scale)));
          span.style.left = delta.x + 'px'; span.style.top = delta.y + 'px';
        });
      }
      layer.base = frameFor(layer);
    }
    for (const [id, source] of state.sourceById) {
      const element = state.copies.get(source);
      if (element && !state.elementsByKey.has(selectorFor(element))) state.elementsByKey.set(selectorFor(element), element);
    }
  }
  function layerFor(element) {
    return state.itemElements.get(state.owners.get(element) || element);
  }
  function drawLayer(layer) {
    const transformed = !layer.plan.matrix.isIdentity;
    function place() {
      layer.wrapper.style.left = (transformed ? 0 : layer.localX) + 'px'; layer.wrapper.style.top = (transformed ? 0 : layer.localY) + 'px';
      layer.wrapper.style.transform = transformed ? 'translate(' + layer.localX + 'px,' + layer.localY + 'px) scale(' + layer.scale + ')' : layer.scale === 1 ? 'none' : 'scale(' + layer.scale + ')';
    }
    place();
    const current = pageRect(layer.element);
    layer.localX += layer.x - current.x; layer.localY += layer.y - current.y;
    place();
  }
  function releaseLayer(layer) {
    if (layer.outer === layer.wrapper) return;
    const shell = layer.outer; state.canvas.append(layer.wrapper); shell.remove(); layer.outer = layer.wrapper;
  }
  function frameFor(layer) {
    const rect = pageRect(layer.element); layer.x = rect.x; layer.y = rect.y;
    return { x: rect.x, y: rect.y, width: rect.width / layer.scale, height: rect.height / layer.scale, scale: layer.scale, parent: null };
  }
  function setFrame(layer, frame, free = false) {
    if (free || frame.parent === null) releaseLayer(layer);
    layer.x = frame.x; layer.y = frame.y; layer.scale = frame.scale; drawLayer(layer);
  }
  function readText(element) { return state.textItems.get(element)?.value ?? element.textContent; }
  function writeText(element, value) { element.textContent = value; if (state.textItems.has(element)) state.textItems.get(element).value = value; }
  function recordFor(element) {
    const selector = selectorFor(element), layer = layerFor(element);
    state.recordIds.set(selector, element.getAttribute('data-iae-node'));
    if (!state.changes.has(selector)) state.changes.set(selector, { selector, tag: sourceOf(element).localName || '#text', beforeStyle: element.getAttribute('style'), styles: {}, attributes: {}, textNodes: {}, beforeFrame: { ...layer.base } });
    return state.changes.get(selector);
  }
  function snapshot() { return JSON.stringify([...state.changes.values()]); }
  function remember() { state.past.push(snapshot()); if (state.past.length > 100) state.past.shift(); state.future = []; }
  function prune(record) { if (!Object.keys(record.styles).length && !Object.keys(record.attributes).length && !Object.keys(record.textNodes).length && !record.text && !record.frame && !record.deleted && !Object.hasOwn(record, 'group')) state.changes.delete(record.selector); }
  function applyRecord(record, reverse = false) {
    const element = find(record); if (!element) return;
    const layer = layerFor(element);
    if (reverse) element.style.cssText = record.beforeStyle;
    else for (const [property, change] of Object.entries(record.styles)) { if (change.after) element.style.setProperty(property, change.after, 'important'); else element.style.removeProperty(property); }
    if (record.text && textAllowed(element)) writeText(element, reverse ? record.text.before : record.text.after);
    for (const [index, change] of Object.entries(record.textNodes)) { const node = element.childNodes[Number(index)]; if (node?.nodeType === Node.TEXT_NODE) node.textContent = reverse ? change.before : change.after; }
    for (const [name, change] of Object.entries(record.attributes)) { const value = reverse ? change.before : change.after; if (value === null) element.removeAttribute(name); else element.setAttribute(name, value); }
    if (record.frame) setFrame(layer, reverse ? record.beforeFrame : record.frame, !Object.hasOwn(record.frame, 'parent'));
    if (Object.hasOwn(record, 'group')) layer.group = reverse ? null : record.group;
    if (record.deleted) { layer.deleted = !reverse; layer.outer.hidden = layer.deleted; }
  }
  function save() {
    if (state.options.persist === true) { try { localStorage.setItem(state.key, JSON.stringify({ version: 2, changes: [...state.changes.values()] })); } catch { toast('Cannot save in this browser. Copy the changes.'); } }
    state.root.querySelector('[data-count]').textContent = state.changes.size || ''; state.root.querySelector('[data-action="undo"]').disabled = !state.past.length; state.root.querySelector('[data-action="redo"]').disabled = !state.future.length;
    state.options.onChange?.(getChanges()); draw();
  }
  function loadHistory(value) { state.changes = new Map(JSON.parse(value).map((record) => [record.selector, record])); rebuildCopy(); save(); renderPanel(); }
  function undo() { finishText(); if (!state?.past.length) return; state.future.push(snapshot()); loadHistory(state.past.pop()); }
  function redo() { finishText(); if (!state?.future.length) return; state.past.push(snapshot()); loadHistory(state.future.pop()); }
  function reset() { finishText(); if (!state?.changes.size) return; remember(); state.changes.clear(); rebuildCopy(); save(); renderPanel(); }
  function setStyle(property, value, element = state?.selected, history = true) {
    element = copyOf(element); if (!state || !editable(element)) return false;
    property = String(property).trim().toLowerCase(); value = String(value).trim();
    if (!/^([a-z][a-z-]*|--[\w-]+)$/.test(property) || (value && !CSS.supports(property, value))) return false;
    if (element.style.getPropertyValue(property) === value) return true;
    if (history) remember();
    const record = recordFor(element), change = record.styles[property] || { before: element.style.getPropertyValue(property), priority: element.style.getPropertyPriority(property), after: '' };
    delete record.styles[property]; record.styles[property] = change;
    if (value) element.style.setProperty(property, value, 'important'); else element.style.removeProperty(property);
    change.after = element.style.getPropertyValue(property);
    if (change.after === change.before) { element.style.setProperty(property, change.before, change.priority); delete record.styles[property]; }
    prune(record); if (history) save(); return true;
  }
  function setText(value, element = state?.selected) {
    element = copyOf(element); if (!state || !textAllowed(element)) return false;
    value = String(value); if (readText(element) === value) return true;
    remember(); const record = recordFor(element); record.text ||= { before: readText(element), after: '' }; record.text.after = value; writeText(element, value);
    if (value === record.text.before) delete record.text; prune(record); save(); return true;
  }
  function controlHistory(key, live) {
    if (state.controlEdit !== key) { remember(); state.controlEdit = key; }
    if (!live) state.controlEdit = null;
  }
  function updateStyleControl(property, value, live = false) {
    if (!state.selection.size || !CSS.supports(property, value)) return false;
    controlHistory(property, live);
    for (const element of state.selection) {
      setStyle(property, value, element, false);
      if (property === 'border-width' && parseFloat(value) > 0 && getComputedStyle(element).borderStyle === 'none') setStyle('border-style', 'solid', element, false);
      if (property === 'border-style' && value !== 'none' && parseFloat(getComputedStyle(element).borderWidth) === 0) setStyle('border-width', '1px', element, false);
    }
    syncControl(property); if (property === 'border-width') syncControl('border-style'); if (property === 'border-style') syncControl('border-width'); save(); return true;
  }
  function updateFrameControl(property, value, live = false) {
    if (!state.selected || !Number.isFinite(value) || (property === 'scale' && value < .02)) return false;
    controlHistory('frame:' + property, live);
    const first = frameFor(layerFor(state.selected)), bounds = boundsFor(state.selection, true), factor = value / first.scale;
    for (const element of state.selection) {
      const layer = layerFor(element), frame = frameFor(layer);
      const next = property === 'scale' ? { ...frame, x: bounds.x + (frame.x - bounds.x) * factor, y: bounds.y + (frame.y - bounds.y) * factor, scale: frame.scale * factor } : { ...frame, [property]: frame[property] + value - first[property] };
      setFrame(layer, next, true); recordFor(element).frame = frameFor(layer);
    }
    syncControl(property, true); save(); return true;
  }
  function syncControl(property, frame = false) {
    if (!state.selected) return;
    const root = state.root, value = frame ? frameFor(layerFor(state.selected))[property] : getComputedStyle(state.selected).getPropertyValue(property);
    const color = root.querySelector('[data-color-field="' + property + '"]');
    if (color) {
      const parts = colorParts(value); color.querySelector('[data-style]').value = colorText(parts); color.querySelector('[data-color]').value = parts.hex;
      color.querySelector('.swatch').style.setProperty('--alpha', parts.alpha); color.querySelector('[data-alpha]').value = Math.round(parts.alpha * 100); color.querySelector('output').textContent = Math.round(parts.alpha * 100) + '%'; return;
    }
    const number = root.querySelector('[data-number="' + property + '"]');
    if (number) { const numeric = parseFloat(value); number.querySelector('input[type=number]').value = Number.isFinite(numeric) ? Math.round(numeric * 100) / 100 : ''; number.querySelector('input[type=range]').value = Number.isFinite(numeric) ? numeric : 0; }
    for (const button of root.querySelectorAll('[data-choice-style="' + property + '"]')) button.setAttribute('aria-pressed', String(button.dataset.value === value));
  }
  function onControl(event) {
    const target = event.target, live = event.type === 'input';
    if (target.dataset.color || target.dataset.alpha) {
      const property = target.dataset.color || target.dataset.alpha, field = target.closest('[data-color-field]'), current = colorParts(getComputedStyle(state.selected).getPropertyValue(property));
      const parts = colorParts(field.querySelector('[data-color]').value); parts.alpha = target.dataset.alpha ? Number(target.value) / 100 : current.alpha || 1;
      updateStyleControl(property, colorText(parts), live); return;
    }
    const property = target.dataset.rangeStyle || target.dataset.style, frame = target.dataset.rangeFrame || target.dataset.frame;
    if (property) {
      if (live && target.type !== 'range' && target.type !== 'number') return;
      let value = target.value.trim();
      if (target.type === 'range' || target.type === 'number') { if (!value || !Number.isFinite(Number(value))) return; value += target.dataset.unit || ''; }
      const valid = updateStyleControl(property, value, live); target.setAttribute('aria-invalid', String(!valid));
    } else if (frame) { if (target.value !== '') updateFrameControl(frame, Number(target.value), live); }
    else if (!live) {
      if (target.hasAttribute('data-text')) setText(target.value);
      if (target.hasAttribute('data-text-node')) setTextNode(Number(target.dataset.textNode), target.value);
      if (target.dataset.attribute) target.setAttribute('aria-invalid', String(!setAttribute(target.dataset.attribute, target.value)));
    }
  }
  function setTextNode(index, value, element = state?.selected) {
    element = copyOf(element); if (!state || !editable(element)) return false;
    const item = state.elementsByKey.get(selectorFor(element) + '::text(' + index + ')');
    if (item) return setText(value, item);
    const node = element.childNodes[index]; if (node?.nodeType !== Node.TEXT_NODE || element.matches(noText)) return false;
    value = String(value); if (node.textContent === value) return true;
    remember(); const record = recordFor(element); record.textNodes[index] ||= { before: node.textContent, after: '' }; record.textNodes[index].after = value; node.textContent = value;
    if (value === record.textNodes[index].before) delete record.textNodes[index]; prune(record); save(); return true;
  }
  function setAttribute(name, value, element = state?.selected) {
    element = copyOf(element); if (!state || !editable(element) || !['src', 'alt', 'href', 'title'].includes(name)) return false;
    value = value === null ? null : String(value);
    if (['src', 'href'].includes(name) && value) { try { if (!['http:', 'https:', 'mailto:', 'tel:'].includes(new URL(value, document.baseURI).protocol)) return false; } catch { return false; } }
    if (element.getAttribute(name) === value) return true;
    remember(); const record = recordFor(element); record.attributes[name] ||= { before: element.getAttribute(name), after: null }; record.attributes[name].after = value;
    if (value === null) element.removeAttribute(name); else element.setAttribute(name, value);
    if (value === record.attributes[name].before) delete record.attributes[name]; prune(record); save(); return true;
  }
  function moveTo(x, y, element = state?.selected) {
    element = copyOf(element); if (!state || !editable(element) || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    remember(); const layer = layerFor(element), record = recordFor(element); setFrame(layer, { ...frameFor(layer), x, y }, true); record.frame = frameFor(layer); save(); return true;
  }
  function getChanges() {
    if (!state) return [];
    return [...state.changes.values()].map((record) => ({ selector: record.selector, tag: record.tag,
      ...(record.deleted ? { deleted: true } : {}), ...(Object.hasOwn(record, 'group') ? { group: record.group } : {}),
      ...(record.frame ? { frame: { ...record.frame } } : {}), ...(record.text ? { text: { ...record.text } } : {}),
      ...(Object.keys(record.textNodes).length ? { textNodes: JSON.parse(JSON.stringify(record.textNodes)) } : {}),
      ...(Object.keys(record.styles).length ? { styles: Object.fromEntries(Object.entries(record.styles).map(([key, value]) => [key, value.after])) } : {}),
      ...(Object.keys(record.attributes).length ? { attributes: Object.fromEntries(Object.entries(record.attributes).map(([key, value]) => [key, value.after])) } : {})
    }));
  }
  function exportChanges(format = 'prompt') {
    finishText(); const changes = getChanges();
    if (format === 'json') return JSON.stringify({ version: 2, page: location.pathname, changes }, null, 2);
    if (format === 'css') return changes.filter((change) => change.styles || change.frame).map((change) => {
      const values = Object.entries(change.styles || {}).map(([key, value]) => '  ' + key + ': ' + (value || 'initial') + ' !important;');
      if (change.frame) values.push('  /* Page position: ' + change.frame.x + 'px, ' + change.frame.y + 'px. Scale: ' + change.frame.scale + '. */');
      return change.selector + ' {\n' + values.join('\n') + '\n}';
    }).join('\n\n');
    return 'Apply these edits to the website source files.\nPage: ' + location.pathname + '\nThe edits use a separate page copy. Frame values give the item’s page position, size before scaling, and scale. ::text(n) identifies text node n within its parent. Match the result in the source files. Check wide and narrow screens.\n\n' + JSON.stringify(changes, null, 2);
  }
  function colorParts(value) {
    function parts(r, g, b, alpha) { return { r, g, b, alpha, hex: '#' + [r, g, b].map((part) => part.toString(16).padStart(2, '0')).join('') }; }
    const rgb = value.match(/^rgba?\(([^)]+)\)$/i);
    if (rgb) {
      const channels = rgb[1].trim().split(/[,\s/]+/);
      const numbers = channels.slice(0, 3).map((channel) => Math.round(parseFloat(channel) * (channel.endsWith('%') ? 2.55 : 1)));
      return parts(...numbers, channels[3] === undefined ? 1 : parseFloat(channels[3]) / (channels[3].endsWith('%') ? 100 : 1));
    }
    if (/^#[\da-f]{3,8}$/i.test(value)) {
      let hex = value.slice(1); if (hex.length < 5) hex = [...hex].map((char) => char + char).join('');
      if (hex.length === 6 || hex.length === 8) return parts(parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16), hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1);
    }
    const context = state.colorContext ||= document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    context.clearRect(0, 0, 1, 1); context.fillStyle = value; context.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
    return parts(r, g, b, a / 255);
  }
  function colorText(parts) { return parts.alpha === 1 ? parts.hex.toUpperCase() : 'rgba(' + [parts.r, parts.g, parts.b, Math.round(parts.alpha * 1000) / 1000].join(', ') + ')'; }
  function colorControl(property, label, value) {
    const parts = colorParts(value);
    return '<div class="color-field" data-color-field="' + property + '"><div class="color-title"><label for="code-' + property + '">' + label + '</label><output data-alpha-value>' + Math.round(parts.alpha * 100) + '%</output></div><div class="color-row"><span class="swatch" style="--alpha:' + parts.alpha + '"><input type="color" data-color="' + property + '" aria-label="Pick ' + label.toLowerCase() + '" value="' + parts.hex + '"></span><input id="code-' + property + '" data-style="' + property + '" aria-label="' + label + '" value="' + escapeHTML(colorText(parts)) + '" spellcheck="false"><input type="range" data-alpha="' + property + '" aria-label="' + label + ' opacity" min="0" max="100" value="' + Math.round(parts.alpha * 100) + '"></div></div>';
  }
  function selectField(property, label, values, current) {
    values = values.map((entry) => Array.isArray(entry) ? entry : [entry, entry]);
    if (!values.some(([value]) => String(value) === current)) values.unshift([current, current]);
    return '<label>' + label + '<select data-style="' + property + '" aria-label="' + label + '">' + values.map(([value, name]) => '<option value="' + escapeHTML(value) + '"' + (String(value) === current ? ' selected' : '') + '>' + escapeHTML(name) + '</option>').join('') + '</select></label>';
  }
  function numberControl(property, label, value, options = {}, frame = false) {
    const unit = options.unit ?? 'px', step = options.step || 1, minimum = options.min ?? 0, limit = options.max || 200, numeric = parseFloat(value);
    const current = Number.isFinite(numeric) ? Math.round(numeric * 100) / 100 : '', maximum = Math.max(limit, Number(current) * 2);
    const kind = frame ? 'frame' : 'style', attributes = ' min="' + minimum + '" max="' + maximum + '" step="' + step + '"';
    return '<div class="number-field" data-number="' + property + '"><div class="number-title"><label for="number-' + property + '">' + label + '</label>' + (options.auto ? '<button class="auto" data-auto-style="' + property + '" data-value="' + options.auto + '" aria-label="Automatic ' + label.toLowerCase() + '">Auto</button>' : '') + '</div><div class="stepper"><button data-step="-1" aria-label="Decrease ' + label.toLowerCase() + '">−</button><input id="number-' + property + '" type="number" data-' + kind + '="' + property + '" data-unit="' + unit + '" aria-label="' + label + '"' + attributes + ' value="' + current + '" placeholder="Auto"><span class="unit" aria-hidden="true">' + unit + '</span><button data-step="1" aria-label="Increase ' + label.toLowerCase() + '">+</button></div><input type="range" data-range-' + kind + '="' + property + '" data-unit="' + unit + '" aria-label="' + label + ' slider"' + attributes + ' value="' + (current === '' ? options.fallback || 0 : current) + '"></div>';
  }
  function choiceControl(property, label, values, current) {
    return '<div class="choice-field"><span class="control-label">' + label + '</span><div class="choices" role="group" aria-label="' + label + '">' + values.map(([value, name]) => '<button data-choice-style="' + property + '" data-value="' + value + '" aria-label="' + label + ': ' + name + '" aria-pressed="' + (value === current) + '">' + name + '</button>').join('') + '</div></div>';
  }
  function fontControl(current) {
    const fonts = [[current, /system-ui|-apple-system/.test(current) ? 'System' : current.split(',')[0].replace(/["']/g, '')], ['system-ui, sans-serif', 'System'], ['Arial, sans-serif', 'Arial'], ['Helvetica, sans-serif', 'Helvetica'], ['Georgia, serif', 'Georgia'], ['Times New Roman, serif', 'Times New Roman'], ['Verdana, sans-serif', 'Verdana'], ['Courier New, monospace', 'Courier New']];
    for (const font of document.fonts) { const family = font.family.replace(/["']/g, ''); if (!fonts.some(([, name]) => name === family)) fonts.push([font.family + ', sans-serif', family]); }
    return selectField('font-family', 'Font', fonts.filter((entry, index, all) => all.findIndex((other) => other[1] === entry[1]) === index), current);
  }
  function renderPanel() {
    if (!state) return;
    const element = state.selected, panel = state.root.querySelector('[data-panel]'); panel.hidden = !state.active || !element?.isConnected; state.root.querySelector('[data-idle]').hidden = !state.active || Boolean(element?.isConnected);
    renderMode();
    if (panel.hidden) { draw(); return; }
    const source = sourceOf(element), css = getComputedStyle(element), multiple = state.selection.size > 1;
    state.root.querySelector('[data-element]').textContent = multiple ? state.selection.size + ' items' : source.getAttribute?.('aria-label') || source.localName || 'Text';
    function numbers(title, properties) { return '<section data-section="' + title.toLowerCase() + '"><h3>' + title + '</h3><div class="grid">' + properties.map(([property, label, options]) => numberControl(property, label, css.getPropertyValue(property), options)).join('') + '</div></section>'; }
    let html = '<section data-section="color"><h3>Color</h3>' + [['color', 'Text color'], ['background-color', 'Background color'], ['border-color', 'Border color']].map(([property, label]) => colorControl(property, label, css.getPropertyValue(property))).join('') + '</section>';
    if (!multiple && textAllowed(element)) html += '<section data-section="text"><textarea data-text aria-label="Text" rows="3">' + escapeHTML(readText(element)) + '</textarea></section>';
    else if (!multiple && !element.matches(noText)) {
      const nodes = [...element.childNodes].map((node, index) => ({ node, index })).filter(({ node }) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
      if (nodes.length) html += '<section data-section="text">' + nodes.map(({ node, index }, order) => '<label>Text ' + (order + 1) + '<textarea data-text-node="' + index + '" aria-label="Text ' + (order + 1) + '" rows="2">' + escapeHTML(node.textContent) + '</textarea></label>').join('') + '</section>';
    }
    html += '<section data-section="border"><h3>Border</h3><div class="grid">' + numberControl('border-radius', 'Radius', css.borderRadius, { max: 100 }) + numberControl('border-width', 'Border width', css.borderWidth, { max: 20 }) + '</div>' + choiceControl('border-style', 'Border style', [['none', 'None'], ['solid', 'Solid'], ['dashed', 'Dash'], ['dotted', 'Dot']], css.borderStyle) + '</section>';
    const frame = frameFor(layerFor(element)), hasText = multiple || Boolean(readText(element).trim());
    if (hasText) {
      html += '<section data-section="font"><h3>Font</h3>' + fontControl(css.fontFamily) + '<div class="grid font-grid">' + numberControl('font-size', 'Font size', css.fontSize, { min: 1, max: 120 }) + selectField('font-weight', 'Weight', [['100', 'Thin'], ['200', 'Extra light'], ['300', 'Light'], ['400', 'Regular'], ['500', 'Medium'], ['600', 'Semibold'], ['700', 'Bold'], ['800', 'Extra bold'], ['900', 'Black']], css.fontWeight) + numberControl('line-height', 'Line height', css.lineHeight, { max: 160, step: .1, auto: 'normal', fallback: parseFloat(css.fontSize) * 1.2 }) + numberControl('letter-spacing', 'Letter spacing', css.letterSpacing, { min: -10, max: 30, step: .1, auto: 'normal' }) + '</div>' + choiceControl('text-align', 'Align', [['left', 'Left'], ['center', 'Center'], ['right', 'Right']], css.textAlign === 'start' ? 'left' : css.textAlign === 'end' ? 'right' : css.textAlign) + '</section>';
    }
    if (element.matches('img')) html += '<section>' + ['src', 'alt'].map((name) => '<label>' + (name === 'src' ? 'Image URL' : 'Alt text') + '<input data-attribute="' + name + '" aria-label="' + (name === 'src' ? 'Image URL' : 'Alt text') + '" value="' + escapeHTML(element.getAttribute(name) || '') + '"></label>').join('') + '</section>';
    if (element.matches('a')) html += '<section><label>Link<input data-attribute="href" aria-label="Link" value="' + escapeHTML(element.getAttribute('href') || '') + '"></label></section>';
    html += numbers('Spacing', [['padding-top', 'Top', { max: 120 }], ['padding-right', 'Right', { max: 120 }], ['padding-bottom', 'Bottom', { max: 120 }], ['padding-left', 'Left', { max: 120 }], ['gap', 'Gap', { max: 120 }]]);
    html += '<section data-position><h3>Position</h3><div class="grid">' + ['x', 'y', 'scale'].map((key) => numberControl(key, key === 'scale' ? 'Scale' : key.toUpperCase(), frame[key], key === 'scale' ? { min: .02, max: 4, step: .01, unit: '' } : { min: -Math.max(state.page.width, state.page.height), max: Math.max(state.page.width, state.page.height) * 2 }, true)).join('') + '</div></section>';
    html += numbers('Size', [['width', 'Width', { max: Math.max(state.page.width, 1000) }], ['height', 'Height', { max: Math.max(state.page.height, 1000) }]]);
    state.root.querySelector('[data-fields]').innerHTML = html; state.root.querySelector('[data-fields]').scrollTop = 0; draw();
  }
  function renderMode() {
    if (!state) return; state.root.querySelector('[data-workspace]').dataset.mode = state.mode;
    for (const button of state.root.querySelectorAll('[data-mode]')) if (button.tagName === 'BUTTON') button.setAttribute('aria-pressed', String(button.dataset.mode === state.mode));
  }
  function setMode(mode) {
    if (!['select', 'move', 'pan'].includes(mode)) return;
    finishText(); endGesture(true); state.controlEdit = null; state.mode = mode; state.lastTap = null; renderMode(); draw();
  }
  function closeReset() {
    state.resetStep = 0; state.root.querySelector('[data-reset-dialog]').hidden = true;
    const target = state.resetFocus; if (target?.isConnected && target.getClientRects().length) target.focus(); else state.root.querySelector('[data-toggle]').focus();
  }
  function requestReset() {
    finishText(); endGesture(true); hideMenu(); state.controlEdit = null; state.resetFocus = state.root.activeElement; state.resetStep = 1; renderReset();
  }
  function renderReset() {
    const root = state.root, second = state.resetStep === 2; root.querySelector('[data-reset-dialog]').hidden = false;
    root.querySelector('[data-reset-title]').textContent = second ? 'Reset to the current page?' : 'Reset edits?';
    root.querySelector('[data-reset-copy]').hidden = !second; root.querySelector('[data-reset-next]').textContent = second ? 'Reset' : 'Continue';
    root.querySelector('[data-reset-next]').classList.toggle('danger', second); root.querySelector('[data-reset-cancel]').focus();
  }
  function confirmReset() {
    if (state.resetStep === 1) { state.resetStep = 2; renderReset(); return; }
    if (state.resetStep !== 2) return;
    closeReset(); if (state.changes.size) remember(); state.changes.clear(); capturePage(); save(); renderPanel();
  }
  function selectItems(elements, expand = true) {
    finishText(); state.controlEdit = null; const items = new Set();
    for (let element of elements) {
      element = copyOf(element); element = state.owners.get(element) || element;
      const layer = layerFor(element); if (!layer || layer.deleted) continue;
      items.add(layer.element);
      if (expand && layer.group) for (const peer of state.layers.values()) if (peer.group === layer.group && !peer.deleted) items.add(peer.element);
    }
    state.selection = items; state.selected = [...items][0] || null; state.lastTap = null; renderPanel();
  }
  function select(element) { if (!state) return false; if (!state.active) setActive(true); element = copyOf(element); if (!layerFor(element)) return false; selectItems([element]); return true; }
  function boundsFor(elements, world = false) {
    const rects = [...elements].filter((element) => element.isConnected && !layerFor(element)?.deleted).map((element) => world ? pageRect(element) : element.getBoundingClientRect());
    if (!rects.length) return null;
    const x = Math.min(...rects.map((rect) => rect.x)), y = Math.min(...rects.map((rect) => rect.y));
    return { x, y, width: Math.max(...rects.map((rect) => rect.x + rect.width)) - x, height: Math.max(...rects.map((rect) => rect.y + rect.height)) - y };
  }
  function drawBox(box, element) {
    if (!element?.isConnected || !element.getClientRects().length) { box.hidden = true; return; }
    const rect = element.getBoundingClientRect(); box.hidden = !rect.width && !rect.height; Object.assign(box.style, { left: rect.left + 'px', top: rect.top + 'px', width: rect.width + 'px', height: rect.height + 'px' });
  }
  function draw() {
    if (!state) return;
    const box = state.root.querySelector('[data-selection]'), bounds = state.active && boundsFor(state.selection);
    box.hidden = !bounds; if (bounds) Object.assign(box.style, { left: bounds.x + 'px', top: bounds.y + 'px', width: bounds.width + 'px', height: bounds.height + 'px' });
    box.querySelectorAll('[data-resize]').forEach((handle) => { handle.hidden = state.selection.size > 1 || state.mode === 'pan'; }); box.querySelector('[data-scale]').hidden = state.mode === 'pan';
    const outlines = state.root.querySelector('[data-selected-items]'); outlines.replaceChildren();
    if (state.active && state.selection.size > 1) for (const element of state.selection) { const outline = document.createElement('div'); outline.className = 'outline member'; outline.dataset.selectedItem = selectorFor(element); drawBox(outline, element); outlines.append(outline); }
    drawBox(state.root.querySelector('[data-hover]'), state.active && !state.selection.has(state.hovered) ? state.hovered : null);
  }
  function drawView() {
    const view = state.view; state.root.querySelector('[data-stage]').style.transform = 'translate(' + view.x + 'px,' + view.y + 'px) scale(' + view.scale + ')';
    state.root.querySelector('[data-zoom-value]').textContent = Math.round(view.scale * 100) + '%'; draw();
  }
  function zoomAt(scale, x = innerWidth / 2, y = innerHeight / 2) {
    const view = state.view, next = Math.min(4, Math.max(.1, scale));
    view.x = x - (x - view.x) * next / view.scale; view.y = y - (y - view.y) * next / view.scale; view.scale = next; drawView();
  }
  function scheduleDraw() { if (!state || state.frame) return; state.frame = requestAnimationFrame(() => { if (state) { state.frame = 0; draw(); } }); }
  function toast(text) { if (!state) return; const note = state.root.querySelector('[data-toast]'); note.textContent = text; note.hidden = false; clearTimeout(state.toastTimer); state.toastTimer = setTimeout(() => { note.hidden = true; }, 2500); }
  function finishText() { if (!state?.typing) return; const { element, before } = state.typing, after = element.innerText; state.typing = null; element.removeAttribute('contenteditable'); writeText(element, before); setText(after, element); }
  function startText(element) {
    if (!textAllowed(element)) return;
    finishText(); state.typing = { element, before: readText(element) }; if (state.textItems.has(element)) writeText(element, readText(element)); element.setAttribute('contenteditable', 'plaintext-only'); element.focus();
    const range = document.createRange(); range.selectNodeContents(element); const selection = state.canvas.getSelection?.() || window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    element.addEventListener('blur', finishText, { once: true, signal: state.abort.signal });
  }
  function setActive(active) {
    if (!state || Boolean(active) === state.active) return;
    finishText(); endGesture(true); state.active = Boolean(active);
    hideMenu(); if (state.resetStep) closeReset(); state.controlEdit = null;
    if (state.active) { state.mode = 'select'; if (state.options.persist !== true) { state.changes.clear(); state.past = []; state.future = []; } capturePage(); save(); }
    else { state.root.querySelector('[data-workspace]').hidden = true; state.selected = state.hovered = null; state.selection.clear(); }
    state.root.querySelector('[data-zoom]').hidden = !state.active;
    const button = state.root.querySelector('[data-toggle]'); button.setAttribute('aria-expanded', String(state.active)); button.setAttribute('aria-label', state.active ? 'Exit edit mode' : 'Edit page'); button.innerHTML = state.active ? icon('close') : 'EDIT'; renderPanel();
  }
  function block(event) { event.preventDefault(); event.stopImmediatePropagation(); }
  function onPointerDown(event) {
    if (!state.active || state.typing?.element.contains(event.composedPath()[0])) return;
    hideMenu();
    state.controlEdit = null;
    if (event.button === 1 || (event.button === 0 && (state.space || state.mode === 'pan'))) {
      block(event); state.gesture = { kind: 'pan', pointer: event.pointerId, startX: event.clientX, startY: event.clientY, view: { ...state.view } }; state.root.querySelector('[data-workspace]').setPointerCapture(event.pointerId); return;
    }
    if (event.button !== 0) return;
    block(event); finishText();
    const target = event.composedPath().find((node) => layerFor(node)), layer = target && layerFor(target), element = layer?.plan.selectable && !layer.deleted ? layer.element : null, tap = state.lastTap;
    const twice = tap && tap.element === element && event.timeStamp - tap.time < 500 && Math.hypot(event.clientX - tap.x, event.clientY - tap.y) < 5;
    if (twice && element && textAllowed(element)) { selectItems([element]); startText(element); return; }
    if (event.shiftKey && element) {
      const members = layer.group ? [...state.layers.values()].filter((peer) => peer.group === layer.group).map((peer) => peer.element) : [element], items = new Set(state.selection);
      for (const member of members) if (items.has(member)) items.delete(member); else items.add(member);
      selectItems(items); return;
    }
    if (!element || (state.mode === 'select' && !layer.plan.atomic)) {
      state.gesture = { kind: 'marquee', pointer: event.pointerId, startX: event.clientX, startY: event.clientY, hit: element, base: event.shiftKey ? [...state.selection] : [], previous: [...state.selection], changed: false };
      state.root.querySelector('[data-workspace]').setPointerCapture(event.pointerId); return;
    }
    if (!state.selection.has(element)) selectItems([element]);
    state.lastTap = { element, time: event.timeStamp, x: event.clientX, y: event.clientY }; beginGesture(event, 'move'); state.gesture.hit = element;
  }
  function beginGesture(event, kind) {
    if (!state.selected || event.button !== 0) return;
    event.preventDefault(); finishText(); hideMenu(); const group = [...state.selection].map(layerFor);
    state.gesture = { kind, pointer: event.pointerId, startX: event.clientX, startY: event.clientY, before: snapshot(), changed: false, bounds: boundsFor(state.selection, true), starts: group.map((item) => ({ layer: item, frame: frameFor(item), width: parseFloat(getComputedStyle(item.element).width), height: parseFloat(getComputedStyle(item.element).height) })) };
    state.root.querySelector('[data-workspace]').setPointerCapture(event.pointerId);
  }
  function moveGesture(event) {
    const gesture = state.gesture; if (!gesture || gesture.pointer !== event.pointerId) return;
    const screenX = event.clientX - gesture.startX, screenY = event.clientY - gesture.startY;
    if (gesture.kind === 'pan') { block(event); state.view.x = gesture.view.x + screenX; state.view.y = gesture.view.y + screenY; drawView(); return; }
    if (!gesture.changed && Math.hypot(screenX, screenY) < 3) return;
    block(event);
    if (gesture.kind === 'marquee') {
      gesture.changed = true; const x = Math.min(gesture.startX, event.clientX), y = Math.min(gesture.startY, event.clientY), width = Math.abs(screenX), height = Math.abs(screenY), box = state.root.querySelector('[data-marquee]');
      box.hidden = false; Object.assign(box.style, { left: x + 'px', top: y + 'px', width: width + 'px', height: height + 'px' });
      const hits = [...state.layers.values()].filter((layer) => {
        if (layer.deleted || !layer.plan.selectable) return false;
        const rect = layer.element.getBoundingClientRect(), surrounds = x > rect.left && y > rect.top && x + width < rect.right && y + height < rect.bottom;
        return !surrounds && rect.left <= x + width && rect.right >= x && rect.top <= y + height && rect.bottom >= y;
      });
      selectItems([...gesture.base, ...hits.map((layer) => layer.element)]); return;
    }
    if (!gesture.changed) { remember(); gesture.changed = true; for (const item of gesture.starts) releaseLayer(item.layer); state.root.querySelector('[data-workspace]').setPointerCapture(event.pointerId); }
    const dx = screenX / state.view.scale, dy = screenY / state.view.scale, start = gesture.bounds;
    if (gesture.kind === 'scale') {
      const w = start.width, h = start.height, factor = Math.max(.02 / Math.min(...gesture.starts.map((item) => item.frame.scale)), 1 + (dx * w + dy * h) / (w * w + h * h));
      for (const item of gesture.starts) { setFrame(item.layer, { ...item.frame, x: start.x + (item.frame.x - start.x) * factor, y: start.y + (item.frame.y - start.y) * factor, scale: item.frame.scale * factor }); recordFor(item.layer.element).frame = frameFor(item.layer); }
    } else if (gesture.kind === 'move') {
      let x = dx, y = dy; if (event.shiftKey) { if (Math.abs(x) > Math.abs(y)) y = 0; else x = 0; }
      for (const item of gesture.starts) { setFrame(item.layer, { ...item.frame, x: item.frame.x + x, y: item.frame.y + y }); recordFor(item.layer.element).frame = frameFor(item.layer); }
    } else {
      const item = gesture.starts[0], side = gesture.kind, x = side === 'w' ? Math.min(dx, item.frame.width * item.frame.scale - 8) : 0, y = side === 'n' ? Math.min(dy, item.frame.height * item.frame.scale - 8) : 0;
      if (side === 'e' || side === 'w') setStyle('width', Math.max(8, item.width + (side === 'e' ? dx : -x) / item.frame.scale) + 'px', item.layer.element, false);
      if (side === 's' || side === 'n') setStyle('height', Math.max(8, item.height + (side === 's' ? dy : -y) / item.frame.scale) + 'px', item.layer.element, false);
      setFrame(item.layer, { ...item.frame, x: item.frame.x + x, y: item.frame.y + y }); recordFor(item.layer.element).frame = frameFor(item.layer);
    }
    draw();
  }
  function endGesture(cancel = false) {
    if (!state?.gesture) return;
    const gesture = state.gesture; state.gesture = null; const workspace = state.root.querySelector('[data-workspace]'); if (workspace.hasPointerCapture(gesture.pointer)) workspace.releasePointerCapture(gesture.pointer);
    if (gesture.kind === 'pan') return;
    if (gesture.kind === 'marquee') { state.root.querySelector('[data-marquee]').hidden = true; if (cancel) selectItems(gesture.previous); else if (!gesture.changed) selectItems(gesture.hit ? [...gesture.base, gesture.hit] : gesture.base); return; }
    if (gesture.changed) { state.lastTap = null; if (cancel) { state.past.pop(); loadHistory(gesture.before); } else { save(); renderPanel(); } }
    else if (!cancel && gesture.hit && state.selection.size > 1) selectItems([gesture.hit]);
  }
  function hideMenu() { if (state) state.root.querySelector('[data-menu]').hidden = true; }
  function onContextMenu(event) {
    if (!state.active) return; block(event); finishText();
    const target = event.composedPath().find((node) => layerFor(node)), layer = target && layerFor(target);
    if (layer?.plan.selectable && !layer.deleted && !state.selection.has(layer.element)) selectItems([layer.element]);
    const menu = state.root.querySelector('[data-menu]'); menu.hidden = false;
    menu.querySelector('[data-action="group"]').disabled = state.selection.size < 2;
    menu.querySelector('[data-action="ungroup"]').disabled = ![...state.selection].some((item) => layerFor(item).group);
    menu.querySelector('[data-action="delete"]').disabled = !state.selection.size;
    const rect = menu.getBoundingClientRect(); Object.assign(menu.style, { left: Math.max(8, Math.min(event.clientX, innerWidth - rect.width - 8)) + 'px', top: Math.max(8, Math.min(event.clientY, innerHeight - rect.height - 8)) + 'px' });
  }
  function groupItems() {
    if (state.selection.size < 2) return; remember(); const id = 'g' + Date.now().toString(36) + (++state.groupSerial);
    for (const element of state.selection) { layerFor(element).group = id; recordFor(element).group = id; } hideMenu(); save(); renderPanel();
  }
  function ungroupItems() {
    const items = [...state.selection].filter((element) => layerFor(element).group); if (!items.length) return; remember();
    for (const element of items) { layerFor(element).group = null; recordFor(element).group = null; } hideMenu(); save(); renderPanel();
  }
  function deleteItems() {
    if (!state.selection.size) return; finishText(); remember();
    for (const element of state.selection) { const layer = layerFor(element); layer.deleted = true; layer.outer.hidden = true; recordFor(element).deleted = true; }
    hideMenu(); selectItems([]); save();
  }
  function moveSelection(dx, dy) {
    remember(); for (const element of state.selection) { const layer = layerFor(element), frame = frameFor(layer); setFrame(layer, { ...frame, x: frame.x + dx, y: frame.y + dy }, true); recordFor(element).frame = frameFor(layer); } save(); renderPanel();
  }
  function onKey(event) {
    if (!state.active) return;
    if (state.resetStep) {
      if (event.key === 'Escape') { block(event); closeReset(); }
      else if (event.key === 'Tab') { block(event); const root = state.root, cancel = root.querySelector('[data-reset-cancel]'), next = root.querySelector('[data-reset-next]'); (root.activeElement === cancel ? next : cancel).focus(); }
      return;
    }
    const target = event.composedPath()[0], typing = target?.matches?.('input,textarea,select,[contenteditable]');
    if (!typing && event.code === 'Space') { block(event); state.space = true; }
    else if (event.key === 'Escape') { block(event); if (!state.root.querySelector('[data-menu]').hidden) hideMenu(); else if (state.gesture) endGesture(true); else if (state.typing) { finishText(); renderPanel(); } else setActive(false); }
    else if (!typing && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { block(event); if (event.shiftKey) redo(); else undo(); }
    else if (!typing && ['Delete', 'Backspace'].includes(event.key) && state.selected) { block(event); deleteItems(); }
    else if (!typing && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'g') { block(event); if (event.shiftKey) ungroupItems(); else groupItems(); }
    else if (!typing && state.selected && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) { block(event); const step = event.shiftKey ? 10 : 1; moveSelection(event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0, event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0); }
  }
  async function copyChanges() {
    const text = exportChanges();
    try { await navigator.clipboard.writeText(text); toast('Copied'); } catch { const area = state.root.querySelector('[data-copy-fallback]'); area.hidden = false; area.value = text; area.focus(); area.select(); }
  }
  function download() { const url = URL.createObjectURL(new Blob([exportChanges('json')], { type: 'application/json' })), link = document.createElement('a'); link.href = url; link.download = 'in-app-editor-changes.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  const styles = `
    .modes{display:flex;gap:4px;padding:8px;border-bottom:1px solid #27272a}.modes button{flex:1;min-width:0;padding:5px 6px;border-color:transparent;background:transparent;font-size:11px}.modes button[aria-pressed=true],.choices button[aria-pressed=true]{background:#3f3f46;border-color:#52525b;color:#fafafa}.control-label{display:block;color:#a1a1aa;font-size:11px}.number-title,.color-title{display:flex;align-items:center;justify-content:space-between;min-height:18px;gap:6px}.color-title output{font-size:10px;color:#71717a}.color-field+.color-field{margin-top:12px}.color-row{display:flex;align-items:center;gap:7px;margin-top:4px}.color-row input{margin:0}.swatch{position:relative;display:block;width:32px;height:32px;flex:0 0 32px;border:1px solid #3f3f46;border-radius:6px;overflow:hidden;background:repeating-conic-gradient(#71717a 0% 25%,#27272a 0% 50%) 0/8px 8px}.swatch input[type=color]{appearance:none;-webkit-appearance:none;display:block;width:100%;height:100%;min-height:0;padding:0;border:0;border-radius:0;opacity:var(--alpha);cursor:pointer;background:transparent}.swatch input[type=color]::-webkit-color-swatch-wrapper{padding:0}.swatch input[type=color]::-webkit-color-swatch{border:0}.swatch input[type=color]::-moz-color-swatch{border:0}.color-row input[data-style]{flex:1;width:0;font-family:ui-monospace,SFMono-Regular,monospace;font-size:11px}.color-row input[type=range]{width:56px;flex:0 0 56px}.app input[type=range]{appearance:auto;display:block;min-height:18px;height:18px;padding:0;border:0;background:transparent;accent-color:#d4d4d8;cursor:pointer;margin-top:7px}.color-row input[type=range]{margin:0}.stepper{display:flex;align-items:center;height:32px;margin-top:4px;border:1px solid #3f3f46;border-radius:6px;background:#ffffff05;overflow:hidden}.stepper button{min-height:30px;width:23px;flex:0 0 23px;border:0;border-radius:0;padding:0;background:transparent;color:#a1a1aa}.stepper input[type=number]{appearance:textfield;-moz-appearance:textfield;margin:0;min-height:30px;height:30px;border:0;background:transparent;border-radius:0;padding:4px 0;text-align:center;font-size:11px}.stepper input::-webkit-inner-spin-button{appearance:none;margin:0}.stepper .unit{font-size:10px;color:#71717a;padding-right:2px}.auto{min-height:18px;height:18px;font-size:9px;padding:0 3px;border:0;background:transparent;color:#71717a}.choices{display:flex;gap:3px;margin-top:5px}.choices button{flex:1;min-width:0;padding:4px;font-size:10px;background:transparent}.choice-field{margin-top:12px}.font-grid{margin-top:12px}.dialog-backdrop{position:fixed;inset:0;display:grid;place-items:center;padding:20px;background:#0009;backdrop-filter:blur(3px);pointer-events:auto;z-index:20}.dialog{width:min(360px,100%);padding:20px;border:1px solid #3f3f46;border-radius:10px;background:#111113;box-shadow:0 16px 60px #0008}.dialog h2{font-size:15px;font-weight:600;margin:0}.dialog p{font-size:12px;color:#a1a1aa;margin:12px 0 0}.dialog-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:24px}.dialog [data-reset-next]{background:#fafafa;color:#18181b}.dialog [data-reset-next].danger{background:#b91c1c;color:#fff;border-color:#b91c1c}

    :host{all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;color-scheme:dark!important}
    [hidden]{display:none!important}.workspace{position:fixed;inset:0;overflow:hidden;overscroll-behavior:contain;pointer-events:auto;background:#18181b;background-image:radial-gradient(#3f3f46 .7px,transparent .7px);background-size:16px 16px;touch-action:none}.stage{position:absolute;left:0;top:0;transform-origin:0 0;box-shadow:0 0 0 1px #3f3f46,0 16px 48px #0004}[data-page-copy]{display:block;width:100%;height:100%}
    .app{font:12px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#fafafa;text-align:left;letter-spacing:0}.app *{box-sizing:border-box}button,input,textarea,select{font:inherit;color:inherit}button{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:32px;padding:6px 10px;border:1px solid #3f3f46;border-radius:6px;background:#18181b;color:#fafafa;cursor:pointer}button:hover{background:#27272a}button:disabled{opacity:.35;cursor:default}button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible{outline:2px solid #a1a1aa;outline-offset:2px}
    .toggle{position:fixed;bottom:20px;right:20px;pointer-events:auto;min-width:40px;height:36px;background:#fafafa;color:#18181b;border-color:#fafafa;font-size:11px;font-weight:600}.toggle:hover{background:#d4d4d8}.idle{position:fixed;right:20px;bottom:68px;display:flex;flex-direction:column;align-items:flex-end;gap:8px;pointer-events:none}.idle button{pointer-events:auto}.hint{padding:9px 12px;border:1px solid #27272a;border-radius:6px;background:#18181b;color:#a1a1aa}
    .panel{position:fixed;right:20px;bottom:68px;width:288px;max-height:calc(100dvh - 88px);display:flex;flex-direction:column;border:1px solid #27272a;border-radius:8px;background:#111113;box-shadow:0 8px 32px #0006;overflow:hidden;pointer-events:auto}.panel.left{left:20px;right:auto}.head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;border-bottom:1px solid #27272a}.element{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}.actions{display:flex;gap:2px}.actions button{width:28px;min-height:28px;padding:5px;border:0;background:transparent}.actions button:hover{background:#27272a}
    .fields{min-height:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:#3f3f46 transparent}section{padding:14px;border-bottom:1px solid #27272a}h3{font-size:11px;font-weight:500;margin:0 0 10px;color:#fafafa}label{display:block;color:#a1a1aa;font-size:11px}input,textarea,select{display:block;width:100%;min-width:0;min-height:32px;margin-top:4px;padding:6px 8px;border:1px solid #3f3f46;border-radius:6px;background:#ffffff05;color:#fafafa;font-size:12px}textarea{min-height:68px;resize:vertical;line-height:1.5}section>textarea{margin:0}section>label+label{margin-top:8px}option{background:#18181b}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.grid+label{margin-top:10px}.wide{width:100%;margin-top:10px}input[aria-invalid=true]{border-color:#f87171}
    .foot{padding:10px 12px;display:flex;align-items:center;gap:5px;background:#111113;border-top:1px solid #27272a}.foot .plain{border:0;background:transparent;color:#a1a1aa;font-size:11px;padding:4px}.foot .plain:hover{color:#fafafa;background:#27272a}.count{color:#71717a;font-size:10px;margin-right:auto}.copy{background:#fafafa;color:#18181b;border-color:#fafafa;min-height:30px;font-size:11px}.copy:hover{background:#d4d4d8}.fallback{padding:0 12px 12px}.fallback:has(textarea[hidden]){display:none}
    .outline{position:fixed;pointer-events:none;border:1px solid #a1a1aa}.hover{border-style:dashed;border-color:#71717a}.handle{position:absolute;pointer-events:auto;width:10px;height:10px;min-height:0;padding:0;border:1px solid #09090b;background:#d4d4d8;border-radius:0;touch-action:none}.handle:hover{background:#fafafa}.handle::before{content:'';position:absolute;inset:-5px}[data-resize=n]{top:-5px;left:calc(50% - 5px);cursor:ns-resize}[data-resize=s]{bottom:-5px;left:calc(50% - 5px);cursor:ns-resize}[data-resize=e]{right:-5px;top:calc(50% - 5px);cursor:ew-resize}[data-resize=w]{left:-5px;top:calc(50% - 5px);cursor:ew-resize}.scale{right:-16px;bottom:-16px;width:20px;height:20px;min-height:0;padding:2px;border-radius:3px;cursor:nwse-resize;background:#fafafa;color:#09090b;touch-action:none}.toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);padding:8px 12px;border:1px solid #3f3f46;border-radius:6px;background:#18181b;max-width:calc(100vw - 100px)}
    .member{border-color:#71717a}.marquee{position:fixed;pointer-events:none;border:1px solid #a1a1aa;background:#a1a1aa18}.menu{position:fixed;min-width:160px;padding:4px;border:1px solid #27272a;border-radius:6px;background:#111113;box-shadow:0 8px 24px #0006;pointer-events:auto}.menu button{display:flex;justify-content:flex-start;width:100%;border:0;background:transparent}.menu button:hover{background:#27272a}.menu button:last-child{color:#fca5a5}.zoom{position:fixed;left:20px;bottom:20px;display:flex;align-items:center;padding:2px;border:1px solid #27272a;border-radius:6px;background:#111113;pointer-events:auto}.zoom button{border:0;background:transparent;min-width:28px;padding:3px 6px}.zoom [data-zoom-value]{min-width:48px}
    @media(max-width:600px){.panel{right:12px;bottom:64px;width:min(288px,calc(100vw - 24px));max-height:60dvh}.panel.left{left:12px;right:auto}.toggle{right:12px;bottom:16px}.idle{right:12px;bottom:64px}}
  `;
  function mount(options = {}) {
    if (state) return api;
    if (!document.body) { if (!readyHandler) { readyHandler = () => { readyHandler = null; mount(options); }; document.addEventListener('DOMContentLoaded', readyHandler, { once: true }); } return api; }
    const host = document.createElement('in-app-editor'), root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<style>' + styles + '</style><div data-workspace class="workspace" tabindex="-1" hidden><div data-stage class="stage"><div data-page-copy></div></div></div><div class="app"><div data-hover class="outline hover" hidden></div><div data-selected-items></div><div data-marquee class="marquee" hidden></div><div data-selection class="outline" hidden>' + ['n', 'e', 's', 'w'].map((side) => '<button data-resize="' + side + '" class="handle" aria-label="Resize ' + ({ n: 'top', e: 'right', s: 'bottom', w: 'left' })[side] + '"></button>').join('') + '<button data-scale class="handle scale" aria-label="Scale item" title="Scale">' + icon('scale') + '</button></div><div data-idle class="idle" hidden><button data-action="reset">Reset</button><div class="hint">Click anywhere to edit</div></div><aside data-panel class="panel" aria-label="Page editor" hidden><div class="modes" role="toolbar" aria-label="Canvas tools">' + [['select', 'Select'], ['move', 'Move'], ['pan', 'Pan']].map(([mode, label]) => '<button data-mode="' + mode + '" aria-label="' + label + (mode === 'pan' ? ' canvas' : ' items') + '" aria-pressed="' + (mode === 'select') + '">' + icon(mode) + label + '</button>').join('') + '</div><header class="head"><span data-element class="element"></span><div class="actions"><button data-action="move" aria-label="Move controls left" title="Move controls">' + icon('side') + '</button><button data-action="undo" aria-label="Undo" title="Undo" disabled>' + icon('undo') + '</button><button data-action="redo" aria-label="Redo" title="Redo" disabled>' + icon('redo') + '</button></div></header><div data-fields class="fields"></div><footer class="foot"><span data-count class="count" aria-label="Changed items"></span><button class="plain" data-action="reset">Reset</button><button class="plain" data-action="download">Export</button><button class="copy" data-action="copy">Copy changes</button></footer><div class="fallback"><textarea data-copy-fallback aria-label="Changes to copy" hidden></textarea></div></aside><button data-toggle class="toggle" aria-label="Edit page" aria-expanded="false">EDIT</button><div data-reset-dialog class="dialog-backdrop" hidden><div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="reset-title" aria-describedby="reset-copy"><h2 id="reset-title" data-reset-title>Reset edits?</h2><p id="reset-copy" data-reset-copy hidden>Your edits will be lost.</p><div class="dialog-actions"><button data-action="reset-cancel" data-reset-cancel>Cancel</button><button data-action="reset-next" data-reset-next>Continue</button></div></div></div><div data-toast class="toast" role="status" hidden></div><div data-menu class="menu" role="menu" hidden>' + [['group', 'Group'], ['ungroup', 'Ungroup'], ['delete', 'Delete']].map(([name, label]) => '<button role="menuitem" data-action="' + name + '">' + icon(name) + label + '</button>').join('') + '</div><div data-zoom class="zoom" aria-label="Canvas zoom" hidden><button data-action="zoom-out" aria-label="Zoom out">−</button><button data-action="zoom-reset" data-zoom-value aria-label="Reset zoom">100%</button><button data-action="zoom-in" aria-label="Zoom in">+</button></div></div>';
    document.documentElement.append(host);
    const canvas = root.querySelector('[data-page-copy]').attachShadow({ mode: 'open' });
    state = { host, root, canvas, options, abort: new AbortController(), changes: new Map(), layers: new Map(), copies: new WeakMap(), sources: new WeakMap(), past: [], future: [], active: false, selected: null, selection: new Set(), mode: 'select', resetStep: 0, controlEdit: null, groupSerial: 0, space: false, view: { x: 0, y: 0, scale: 1 }, hovered: null, typing: null, gesture: null, frame: 0, toastTimer: 0, key: options.storageKey || 'in-app-editor:v2:' + location.pathname };
    if (options.persist === true) { try { const saved = JSON.parse(localStorage.getItem(state.key)); if (saved?.version === 2 && Array.isArray(saved.changes)) for (const record of saved.changes) { if (record && typeof record.selector === 'string' && record.styles && record.attributes && record.textNodes && typeof record.beforeStyle === 'string') state.changes.set(record.selector, record); } } catch {} }
    const signal = state.abort.signal, workspace = root.querySelector('[data-workspace]');
    workspace.addEventListener('pointerdown', onPointerDown, { signal }); workspace.addEventListener('contextmenu', onContextMenu, { signal }); canvas.addEventListener('click', (event) => { if (!state.typing?.element.contains(event.target)) block(event); }, { capture: true, signal });
    canvas.addEventListener('pointerover', (event) => { if (!state.gesture && !state.typing) { const layer = layerFor(event.target); state.hovered = layer?.plan.selectable && !layer.deleted ? layer.element : null; scheduleDraw(); } }, { signal }); canvas.addEventListener('submit', block, { capture: true, signal });
    workspace.addEventListener('pointermove', moveGesture, { capture: true, signal }); workspace.addEventListener('pointerup', () => endGesture(), { capture: true, signal }); workspace.addEventListener('pointercancel', () => endGesture(true), { capture: true, signal });
    workspace.addEventListener('wheel', (event) => {
      block(event); if (state.gesture || state.typing) return; hideMenu();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1;
      if (event.metaKey || event.ctrlKey) zoomAt(state.view.scale * Math.exp(-event.deltaY * unit * .002), event.clientX, event.clientY);
      else { state.view.x -= (event.shiftKey ? event.deltaY : event.deltaX) * unit; state.view.y -= (event.shiftKey ? event.deltaX : event.deltaY) * unit; drawView(); }
    }, { passive: false, signal });
    root.querySelectorAll('[data-resize]').forEach((handle) => handle.addEventListener('pointerdown', (event) => beginGesture(event, handle.dataset.resize), { signal })); root.querySelector('[data-scale]').addEventListener('pointerdown', (event) => beginGesture(event, 'scale'), { signal }); root.querySelector('[data-toggle]').addEventListener('click', () => setActive(!state.active), { signal });
    root.querySelector('[data-selection]').addEventListener('contextmenu', onContextMenu, { signal });
    document.addEventListener('keydown', onKey, { capture: true, signal }); window.addEventListener('scroll', scheduleDraw, { capture: true, passive: true, signal }); window.addEventListener('resize', scheduleDraw, { passive: true, signal });
    document.addEventListener('keyup', (event) => { if (event.code === 'Space') state.space = false; }, { signal }); window.addEventListener('blur', () => { state.space = false; endGesture(true); }, { signal });
    root.addEventListener('click', (event) => {
      const target = event.target.closest('button'); if (!target) return;
      if (target.dataset.mode) { setMode(target.dataset.mode); return; }
      if (target.dataset.step) { const input = target.closest('[data-number]').querySelector('input[type=number]'); input.stepUp(Number(target.dataset.step)); onControl({ target: input, type: 'change' }); return; }
      if (target.dataset.choiceStyle || target.dataset.autoStyle) { updateStyleControl(target.dataset.choiceStyle || target.dataset.autoStyle, target.dataset.value); return; }
      const actions = { undo, redo, reset: requestReset, 'reset-next': confirmReset, 'reset-cancel': closeReset, copy: copyChanges, download, group: groupItems, ungroup: ungroupItems, delete: deleteItems, 'zoom-in': () => zoomAt(state.view.scale * 1.2), 'zoom-out': () => zoomAt(state.view.scale / 1.2), 'zoom-reset': () => { state.view = { x: -window.scrollX, y: -window.scrollY, scale: 1 }; drawView(); }, move: () => { const left = root.querySelector('[data-panel]').classList.toggle('left'); target.setAttribute('aria-label', left ? 'Move controls right' : 'Move controls left'); } }; actions[target.dataset.action]?.();
    }, { signal });
    root.addEventListener('input', onControl, { signal }); root.addEventListener('change', onControl, { signal });
    root.addEventListener('focusout', () => { state.controlEdit = null; }, { signal });
    save(); if (options.open) setActive(true); return api;
  }
  function destroy() { if (readyHandler) { document.removeEventListener('DOMContentLoaded', readyHandler); readyHandler = null; } if (!state) return; finishText(); endGesture(true); state.abort.abort(); clearTimeout(state.toastTimer); cancelAnimationFrame(state.frame); state.host.remove(); state = null; }
  const api = Object.freeze({ mount, destroy, open: () => setActive(true), close: () => setActive(false), toggle: () => setActive(!state?.active), select, setStyle, setText, setTextNode, setAttribute, moveTo, undo, redo, reset, getChanges, exportChanges, version: '0.5.0' });
  window.InAppEditor = api;
  if (script && script.dataset.auto !== 'false') mount({ persist: script.dataset.persist === 'true', open: script.dataset.open === 'true' });
})();
