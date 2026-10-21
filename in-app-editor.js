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
    close: '<path d="m6 6 12 12M6 18 18 6"/>', undo: '<path d="M9 5 4 10l5 5M4 10h10a6 6 0 0 1 0 12"/>', redo: '<path d="m15 5 5 5-5 5M20 10H10a6 6 0 0 0 0 12"/>',
    parent: '<path d="M7 14 12 9l5 5M4 4h16"/>', side: '<path d="M8 3H4v18h4M16 3h4v18h-4M11 7l-4 5 4 5M13 7l4 5-4 5"/>', scale: '<path d="M8 16 17 7M8 7h9v9"/>'
  };
  function icon(name) { return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + icons[name] + '</svg>'; }
  function escapeHTML(value) { return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
  function sourceOf(element) { return state?.sources.get(element) || element; }
  function copyOf(element) { return state?.copies.get(element) || element; }
  function editable(element) { return element instanceof Element && state.sources.has(element) && !element.matches(excluded) && Boolean(element.style); }
  function textAllowed(element) { return editable(element) && element.childElementCount === 0 && !element.matches(noText); }
  function selectorFor(element) {
    element = sourceOf(element);
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
  function find(record) {
    try {
      const source = state.sourceById.get(state.recordIds.get(record.selector)) || document.querySelector(record.selector);
      const element = source?.localName === record.tag ? state.copies.get(source) : null;
      if (element) state.recordIds.set(record.selector, element.getAttribute('data-iae-node'));
      return element;
    } catch { return null; }
  }
  // Read the source page once. All edits use these copies.
  function capturePage() {
    const workspace = state.root.querySelector('[data-workspace]'), stage = state.root.querySelector('[data-stage]');
    state.sources = new WeakMap(); state.copies = new WeakMap(); state.layers = new Map(); state.sourceById = new Map(); state.recordIds = new Map(); state.selected = state.hovered = null; state.canvas.replaceChildren();
    const width = Math.max(document.documentElement.scrollWidth, window.innerWidth), height = Math.max(document.documentElement.scrollHeight, window.innerHeight);
    Object.assign(stage.style, { width: width + 'px', minHeight: height + 'px' });
    const pageCSS = getComputedStyle(document.documentElement);
    workspace.style.colorScheme = pageCSS.colorScheme;
    workspace.style.background = pageCSS.backgroundColor === 'rgba(0, 0, 0, 0)' ? 'Canvas' : pageCSS.background;
    let serial = 0;
    const pseudoRules = [];
    function declarations(css) { return [...css].map((key) => key + ':' + css.getPropertyValue(key) + ';').join(''); }
    function copyNode(source) {
      if (source.nodeType === Node.TEXT_NODE) return document.createTextNode(source.textContent);
      if (source.nodeType === Node.COMMENT_NODE) return document.createComment(source.textContent);
      if (!(source instanceof Element) || source.matches(excluded)) return document.createComment('');
      const css = getComputedStyle(source);
      const element = source.localName.includes('-') ? document.createElement('div') : source.cloneNode(false);
      if (source.localName.includes('-')) for (const attribute of source.attributes) element.setAttribute(attribute.name, attribute.value);
      for (const attribute of [...element.attributes]) if (/^on/i.test(attribute.name) || ['autofocus', 'contenteditable', 'srcdoc'].includes(attribute.name)) element.removeAttribute(attribute.name);
      if (element.localName === 'iframe') { element.removeAttribute('src'); element.setAttribute('sandbox', ''); }
      element.style.cssText = declarations(css);
      element.style.removeProperty('-webkit-user-modify');
      if (source !== document.body && source.parentElement) {
        const parent = getComputedStyle(source.parentElement);
        for (const property of inherited) if (css.getPropertyValue(property) === parent.getPropertyValue(property)) element.style.removeProperty(property);
      }
      if (css.getPropertyValue('-webkit-text-fill-color') === css.color) element.style.removeProperty('-webkit-text-fill-color');
      element.style.setProperty('animation', 'none', 'important'); element.style.setProperty('transition', 'none', 'important'); element.style.setProperty('pointer-events', 'auto', 'important'); element.style.removeProperty('cursor');
      const id = String(++serial); element.setAttribute('data-iae-node', id); state.sources.set(element, source); state.copies.set(source, element); state.sourceById.set(id, source);
      for (const name of ['::before', '::after']) { const pseudo = getComputedStyle(source, name); if (pseudo.content && !['none', 'normal'].includes(pseudo.content)) pseudoRules.push('[data-iae-node="' + id + '"]' + name + '{' + declarations(pseudo) + '}'); }
      for (const child of source.childNodes) { const copy = copyNode(child); if (copy) element.append(copy); }
      if (source instanceof HTMLInputElement) { element.value = source.value; element.checked = source.checked; }
      if (source instanceof HTMLTextAreaElement) element.value = source.value;
      if (source instanceof HTMLSelectElement) element.selectedIndex = source.selectedIndex;
      if (source instanceof HTMLCanvasElement) { try { element.getContext('2d')?.drawImage(source, 0, 0); } catch {} }
      if (source instanceof HTMLVideoElement) { element.autoplay = false; element.muted = true; element.pause(); }
      return element;
    }
    const body = copyNode(document.body), css = document.createElement('style');
    body.style.setProperty('isolation', 'isolate', 'important');
    css.textContent = ':host{display:flow-root;position:relative;min-height:inherit}*{cursor:grab!important;user-select:none!important}[contenteditable]{cursor:text!important;user-select:text!important}[data-iae-placeholder],[data-iae-placeholder] *,[data-iae-placeholder]::before,[data-iae-placeholder]::after,[data-iae-placeholder] *::before,[data-iae-placeholder] *::after{visibility:hidden!important;pointer-events:none!important}' + pseudoRules.join('');
    state.template = body.cloneNode(true); copyValues(body, state.template); state.snapshotCSS = css.cloneNode(true);
    state.canvas.append(css, body); workspace.hidden = false; workspace.scrollLeft = window.scrollX; workspace.scrollTop = window.scrollY; workspace.focus({ preventScroll: true });
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
    const selected = sourceOf(state.selected), body = state.template.cloneNode(true);
    copyValues(state.template, body); state.sources = new WeakMap(); state.copies = new WeakMap(); state.layers = new Map(); state.selected = state.hovered = null; state.lastTap = null;
    for (const element of [body, ...body.querySelectorAll('[data-iae-node]')]) {
      const source = state.sourceById.get(element.getAttribute('data-iae-node'));
      if (source) { state.sources.set(element, source); state.copies.set(source, element); }
    }
    state.canvas.replaceChildren(state.snapshotCSS.cloneNode(true), body);
    for (const record of state.changes.values()) applyRecord(record);
    if (selected && state.copies.has(selected)) select(selected);
  }
  function pageRect(element) {
    const rect = element.getBoundingClientRect(), workspace = state.root.querySelector('[data-workspace]');
    return { x: rect.left + workspace.scrollLeft, y: rect.top + workspace.scrollTop, width: rect.width, height: rect.height };
  }
  function layerFor(element) {
    const selector = selectorFor(element);
    if (state.layers.has(selector)) return state.layers.get(selector);
    const rect = pageRect(element), computed = getComputedStyle(element), css = { width: computed.width, height: computed.height, display: computed.display, transform: computed.transform }, inheritedValues = Object.fromEntries([...inherited].map((key) => [key, computed.getPropertyValue(key)])), placeholder = element.cloneNode(true);
    for (const node of [placeholder, ...placeholder.querySelectorAll('*')]) { node.style.setProperty('visibility', 'hidden', 'important'); node.style.setProperty('pointer-events', 'none', 'important'); }
    placeholder.setAttribute('aria-hidden', 'true'); placeholder.setAttribute('data-iae-placeholder', ''); element.replaceWith(placeholder);
    const wrapper = document.createElement('div'); wrapper.setAttribute('data-iae-layer', ''); wrapper.style.cssText = 'position:absolute;left:0;top:0;z-index:1;margin:0;padding:0;border:0;transform-origin:0 0;pointer-events:none;';
    for (const [key, value] of Object.entries(inheritedValues)) element.style.setProperty(key, key === '-webkit-text-fill-color' && value === inheritedValues.color ? 'currentcolor' : value);
    element.style.setProperty('position', 'relative', 'important'); element.style.setProperty('inset', 'auto', 'important'); element.style.setProperty('margin', '0', 'important'); element.style.setProperty('flex', 'none', 'important'); element.style.setProperty('width', css.width, 'important'); element.style.setProperty('height', css.height, 'important');
    if (css.display === 'inline') element.style.setProperty('display', 'inline-block', 'important');
    wrapper.append(element); state.canvas.append(wrapper);
    const moved = pageRect(element), layer = { element, wrapper, placeholder, source: sourceOf(element), x: rect.x - moved.x, y: rect.y - moved.y, scale: 1 };
    const sx = moved.width ? rect.width / moved.width : 1, sy = moved.height ? rect.height / moved.height : 1;
    if (Math.abs(sx - 1) > .001 || Math.abs(sy - 1) > .001) {
      element.style.setProperty('transform-origin', '0 0', 'important'); element.style.setProperty('transform', 'scale(' + sx + ',' + sy + ') ' + (css.transform === 'none' ? '' : css.transform), 'important');
      const adjusted = pageRect(element); layer.x = rect.x - adjusted.x; layer.y = rect.y - adjusted.y;
    }
    state.layers.set(selector, layer);
    for (const child of state.layers.values()) if (child !== layer && layer.source.contains(child.source)) state.canvas.append(child.wrapper);
    drawLayer(layer); layer.base = frameFor(layer); return layer;
  }
  function drawLayer(layer) { layer.wrapper.style.transform = 'translate(' + layer.x + 'px,' + layer.y + 'px) scale(' + layer.scale + ')'; }
  function frameFor(layer) { const rect = pageRect(layer.element); return { x: layer.x, y: layer.y, width: rect.width / layer.scale, height: rect.height / layer.scale, scale: layer.scale }; }
  function setFrame(layer, frame) { layer.x = frame.x; layer.y = frame.y; layer.scale = frame.scale; drawLayer(layer); }
  function recordFor(element) {
    const selector = selectorFor(element), layer = layerFor(element);
    state.recordIds.set(selector, element.getAttribute('data-iae-node'));
    if (!state.changes.has(selector)) state.changes.set(selector, { selector, tag: sourceOf(element).localName, beforeStyle: element.getAttribute('style'), styles: {}, attributes: {}, textNodes: {}, beforeFrame: { ...layer.base } });
    return state.changes.get(selector);
  }
  function snapshot() { return JSON.stringify([...state.changes.values()]); }
  function remember() { state.past.push(snapshot()); if (state.past.length > 100) state.past.shift(); state.future = []; }
  function prune(record) { if (!Object.keys(record.styles).length && !Object.keys(record.attributes).length && !Object.keys(record.textNodes).length && !record.text && !record.frame) state.changes.delete(record.selector); }
  function applyRecord(record, reverse = false) {
    const element = find(record); if (!element) return;
    const layer = layerFor(element);
    if (reverse) element.style.cssText = record.beforeStyle;
    else for (const [property, change] of Object.entries(record.styles)) { if (change.after) element.style.setProperty(property, change.after, 'important'); else element.style.removeProperty(property); }
    if (record.text && element.childElementCount === 0) element.textContent = reverse ? record.text.before : record.text.after;
    for (const [index, change] of Object.entries(record.textNodes)) { const node = element.childNodes[Number(index)]; if (node?.nodeType === Node.TEXT_NODE) node.textContent = reverse ? change.before : change.after; }
    for (const [name, change] of Object.entries(record.attributes)) { const value = reverse ? change.before : change.after; if (value === null) element.removeAttribute(name); else element.setAttribute(name, value); }
    if (record.frame) setFrame(layer, reverse ? record.beforeFrame : record.frame);
  }
  function save() {
    if (state.options.persist !== false) { try { localStorage.setItem(state.key, JSON.stringify({ version: 2, changes: [...state.changes.values()] })); } catch { toast('Cannot save in this browser. Copy the changes.'); } }
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
    value = String(value); if (element.textContent === value) return true;
    remember(); const record = recordFor(element); record.text ||= { before: element.textContent, after: '' }; record.text.after = value; element.textContent = value;
    if (value === record.text.before) delete record.text; prune(record); save(); return true;
  }
  function setTextNode(index, value, element = state?.selected) {
    element = copyOf(element); if (!state || !editable(element)) return false;
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
    remember(); const layer = layerFor(element), record = recordFor(element); setFrame(layer, { ...frameFor(layer), x, y }); record.frame = frameFor(layer); save(); return true;
  }
  function getChanges() {
    if (!state) return [];
    return [...state.changes.values()].map((record) => ({ selector: record.selector, tag: record.tag,
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
    return 'Apply these edits to the website source files.\nPage: ' + location.pathname + '\nThe edits use a separate page copy. Frame values give the item’s page position, size before scaling, and scale. Match the result in the source files. Check wide and narrow screens.\n\n' + JSON.stringify(changes, null, 2);
  }
  function field(property, label, value) { return '<label>' + label + '<input data-style="' + property + '" aria-label="' + label + '" value="' + escapeHTML(value) + '" spellcheck="false"></label>'; }
  function selectField(property, label, values, current) {
    if (!values.includes(current)) values = [current, ...values];
    return '<label>' + label + '<select data-style="' + property + '" aria-label="' + label + '">' + values.map((value) => '<option' + (value === current ? ' selected' : '') + '>' + escapeHTML(value) + '</option>').join('') + '</select></label>';
  }
  function renderPanel() {
    if (!state) return;
    const element = state.selected, panel = state.root.querySelector('[data-panel]'); panel.hidden = !state.active || !element?.isConnected; state.root.querySelector('[data-idle]').hidden = !state.active || Boolean(element?.isConnected);
    if (panel.hidden) { draw(); return; }
    const source = sourceOf(element), css = getComputedStyle(element); state.root.querySelector('[data-element]').textContent = source.getAttribute('aria-label') || source.localName;
    let html = '';
    if (textAllowed(element)) html += '<section><textarea data-text aria-label="Text" rows="3">' + escapeHTML(element.textContent) + '</textarea></section>';
    else if (!element.matches(noText)) {
      const nodes = [...element.childNodes].map((node, index) => ({ node, index })).filter(({ node }) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
      if (nodes.length) html += '<section>' + nodes.map(({ node, index }, order) => '<label>Text ' + (order + 1) + '<textarea data-text-node="' + index + '" aria-label="Text ' + (order + 1) + '" rows="2">' + escapeHTML(node.textContent) + '</textarea></label>').join('') + '</section>';
    }
    if (element.matches('img')) html += '<section>' + ['src', 'alt'].map((name) => '<label>' + (name === 'src' ? 'Image URL' : 'Alt text') + '<input data-attribute="' + name + '" aria-label="' + (name === 'src' ? 'Image URL' : 'Alt text') + '" value="' + escapeHTML(element.getAttribute(name) || '') + '"></label>').join('') + '</section>';
    if (element.matches('a')) html += '<section><label>Link<input data-attribute="href" aria-label="Link" value="' + escapeHTML(element.getAttribute('href') || '') + '"></label></section>';
    const frame = frameFor(layerFor(element));
    html += '<section><div class="grid">' + ['x', 'y', 'scale'].map((key) => '<label>' + (key === 'scale' ? 'Scale' : key.toUpperCase()) + '<input data-frame="' + key + '" aria-label="' + (key === 'scale' ? 'Scale' : key.toUpperCase()) + '" type="number" step="' + (key === 'scale' ? '.05' : '1') + '" value="' + Math.round(frame[key] * 100) / 100 + '"></label>').join('') + '</div></section>';
    for (const [heading, properties] of [
      ['Size', [['width', 'Width'], ['height', 'Height']]], ['Text', [['font-family', 'Font'], ['font-size', 'Size'], ['font-weight', 'Weight'], ['line-height', 'Line height'], ['letter-spacing', 'Letter spacing']]],
      ['Color', [['color', 'Text'], ['background-color', 'Fill']]], ['Border', [['border-radius', 'Radius'], ['border-width', 'Width'], ['border-style', 'Style'], ['border-color', 'Color']]],
      ['Spacing', [['padding-top', 'Top'], ['padding-right', 'Right'], ['padding-bottom', 'Bottom'], ['padding-left', 'Left'], ['gap', 'Gap']]]
    ]) html += '<section><h3>' + heading + '</h3><div class="grid">' + properties.map(([property, label]) => field(property, label, css.getPropertyValue(property))).join('') + '</div>' + (heading === 'Text' ? selectField('text-align', 'Align', ['left', 'center', 'right'], css.textAlign) : '') + '</section>';
    html += '<section><form data-custom><div class="grid"><label>Property<input name="property" aria-label="Style property" required></label><label>Value<input name="value" aria-label="Style value" required></label></div><button type="submit" class="wide">Apply</button></form></section>';
    state.root.querySelector('[data-fields]').innerHTML = html; draw();
  }
  function select(element) { if (!state) return false; if (!state.active) setActive(true); element = copyOf(element); if (element instanceof SVGElement) element = element.closest('svg') || element; if (!editable(element)) return false; finishText(); layerFor(element); state.selected = element; renderPanel(); return true; }
  function drawBox(box, element) {
    if (!element?.isConnected || !element.getClientRects().length) { box.hidden = true; return; }
    const rect = element.getBoundingClientRect(); box.hidden = !rect.width && !rect.height; Object.assign(box.style, { left: rect.left + 'px', top: rect.top + 'px', width: rect.width + 'px', height: rect.height + 'px' });
  }
  function draw() { if (!state) return; drawBox(state.root.querySelector('[data-selection]'), state.active ? state.selected : null); drawBox(state.root.querySelector('[data-hover]'), state.active && state.hovered !== state.selected ? state.hovered : null); }
  function scheduleDraw() { if (!state || state.frame) return; state.frame = requestAnimationFrame(() => { if (state) { state.frame = 0; draw(); } }); }
  function toast(text) { if (!state) return; const note = state.root.querySelector('[data-toast]'); note.textContent = text; note.hidden = false; clearTimeout(state.toastTimer); state.toastTimer = setTimeout(() => { note.hidden = true; }, 2500); }
  function finishText() { if (!state?.typing) return; const { element, before } = state.typing, after = element.textContent; state.typing = null; element.removeAttribute('contenteditable'); element.textContent = before; setText(after, element); }
  function startText(element) {
    if (!textAllowed(element)) return;
    finishText(); state.typing = { element, before: element.textContent }; element.setAttribute('contenteditable', 'plaintext-only'); element.focus();
    const range = document.createRange(); range.selectNodeContents(element); const selection = state.canvas.getSelection?.() || window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    element.addEventListener('blur', finishText, { once: true, signal: state.abort.signal });
  }
  function setActive(active) {
    if (!state || Boolean(active) === state.active) return;
    finishText(); endGesture(true); state.active = Boolean(active);
    if (state.active) capturePage(); else { state.root.querySelector('[data-workspace]').hidden = true; state.selected = state.hovered = null; }
    const button = state.root.querySelector('[data-toggle]'); button.setAttribute('aria-expanded', String(state.active)); button.setAttribute('aria-label', state.active ? 'Exit edit mode' : 'Edit page'); button.innerHTML = state.active ? icon('close') : 'EDIT'; renderPanel();
  }
  function block(event) { event.preventDefault(); event.stopImmediatePropagation(); }
  function onPointerDown(event) {
    if (!state.active || event.button !== 0 || state.typing?.element.contains(event.target) || !editable(event.target)) return;
    block(event);
    const element = state.selected?.contains(event.target) && !event.altKey ? state.selected : event.target, tap = state.lastTap;
    const twice = tap && tap.element === element && event.timeStamp - tap.time < 500 && Math.hypot(event.clientX - tap.x, event.clientY - tap.y) < 5;
    select(element);
    if (twice && textAllowed(element)) { state.lastTap = null; startText(element); return; }
    state.lastTap = { element, time: event.timeStamp, x: event.clientX, y: event.clientY }; beginGesture(event, 'move');
  }
  function beginGesture(event, kind) {
    if (!state.selected) return;
    event.preventDefault(); finishText(); const layer = layerFor(state.selected), source = sourceOf(state.selected);
    const group = [layer, ...[...state.layers.values()].filter((item) => item !== layer && source.contains(item.source))];
    state.gesture = { kind, pointer: event.pointerId, startX: event.clientX, startY: event.clientY, before: snapshot(), changed: false, layer, starts: group.map((item) => ({ layer: item, frame: frameFor(item), width: parseFloat(getComputedStyle(item.element).width), height: parseFloat(getComputedStyle(item.element).height) })) };
    if (kind !== 'move') state.root.querySelector('[data-workspace]').setPointerCapture(event.pointerId);
  }
  function moveGesture(event) {
    const gesture = state.gesture; if (!gesture || gesture.pointer !== event.pointerId) return;
    const dx = event.clientX - gesture.startX, dy = event.clientY - gesture.startY; if (!gesture.changed && Math.hypot(dx, dy) < 3) return;
    block(event); if (!gesture.changed) { remember(); gesture.changed = true; state.root.querySelector('[data-workspace]').setPointerCapture(event.pointerId); }
    const start = gesture.starts[0].frame;
    if (gesture.kind === 'scale') {
      const w = start.width * start.scale, h = start.height * start.scale, factor = Math.max(.02 / start.scale, 1 + (dx * w + dy * h) / (w * w + h * h));
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
    if (gesture.changed) { state.lastTap = null; if (cancel) { state.past.pop(); loadHistory(gesture.before); } else { save(); renderPanel(); } }
  }
  function onKey(event) {
    if (!state.active) return;
    const target = event.composedPath()[0], typing = target?.matches?.('input,textarea,select,[contenteditable]');
    if (event.key === 'Escape') { block(event); if (state.gesture) endGesture(true); else if (state.typing) { finishText(); renderPanel(); } else setActive(false); }
    else if (!typing && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { block(event); if (event.shiftKey) redo(); else undo(); }
    else if (!typing && event.altKey && event.key === 'ArrowUp' && state.selected) { block(event); select(sourceOf(state.selected).parentElement); }
    else if (!typing && state.selected && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) { block(event); const layer = layerFor(state.selected), step = event.shiftKey ? 10 : 1; moveTo(layer.x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0), layer.y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0)); renderPanel(); }
  }
  async function copyChanges() {
    const text = exportChanges();
    try { await navigator.clipboard.writeText(text); toast('Copied'); } catch { const area = state.root.querySelector('[data-copy-fallback]'); area.hidden = false; area.value = text; area.focus(); area.select(); }
  }
  function download() { const url = URL.createObjectURL(new Blob([exportChanges('json')], { type: 'application/json' })), link = document.createElement('a'); link.href = url; link.download = 'in-app-editor-changes.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  const styles = `
    :host{all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;color-scheme:dark!important}
    [hidden]{display:none!important}.workspace{position:fixed;inset:0;overflow:auto;overscroll-behavior:contain;pointer-events:auto;background:#09090b}.stage{position:relative}
    .app{font:12px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#fafafa;text-align:left;letter-spacing:0}.app *{box-sizing:border-box}button,input,textarea,select{font:inherit;color:inherit}button{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:32px;padding:6px 10px;border:1px solid #3f3f46;border-radius:6px;background:#18181b;color:#fafafa;cursor:pointer}button:hover{background:#27272a}button:disabled{opacity:.35;cursor:default}button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible{outline:2px solid #a1a1aa;outline-offset:2px}
    .toggle{position:fixed;bottom:20px;right:20px;pointer-events:auto;min-width:40px;height:36px;background:#fafafa;color:#18181b;border-color:#fafafa;font-size:11px;font-weight:600}.toggle:hover{background:#d4d4d8}.idle{position:fixed;right:20px;bottom:68px;padding:9px 12px;border:1px solid #27272a;border-radius:6px;background:#18181b;color:#a1a1aa;pointer-events:none}
    .panel{position:fixed;right:20px;bottom:68px;width:288px;max-height:calc(100dvh - 88px);display:flex;flex-direction:column;border:1px solid #27272a;border-radius:8px;background:#111113;box-shadow:0 8px 32px #0006;overflow:hidden;pointer-events:auto}.panel.left{left:20px;right:auto}.head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;border-bottom:1px solid #27272a}.element{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}.actions{display:flex;gap:2px}.actions button{width:28px;min-height:28px;padding:5px;border:0;background:transparent}.actions button:hover{background:#27272a}
    .fields{min-height:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:#3f3f46 transparent}section{padding:14px;border-bottom:1px solid #27272a}h3{font-size:11px;font-weight:500;margin:0 0 10px;color:#fafafa}label{display:block;color:#a1a1aa;font-size:11px}input,textarea,select{display:block;width:100%;min-width:0;min-height:32px;margin-top:4px;padding:6px 8px;border:1px solid #3f3f46;border-radius:6px;background:#ffffff05;color:#fafafa;font-size:12px}textarea{min-height:68px;resize:vertical;line-height:1.5}section>textarea{margin:0}section>label+label{margin-top:8px}option{background:#18181b}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.grid+label{margin-top:10px}.wide{width:100%;margin-top:10px}input[aria-invalid=true]{border-color:#f87171}
    .foot{padding:10px 12px;display:flex;align-items:center;gap:5px;background:#111113;border-top:1px solid #27272a}.foot .plain{border:0;background:transparent;color:#a1a1aa;font-size:11px;padding:4px}.foot .plain:hover{color:#fafafa;background:#27272a}.count{color:#71717a;font-size:10px;margin-right:auto}.copy{background:#fafafa;color:#18181b;border-color:#fafafa;min-height:30px;font-size:11px}.copy:hover{background:#d4d4d8}.fallback{padding:0 12px 12px}.fallback:has(textarea[hidden]){display:none}
    .outline{position:fixed;pointer-events:none;border:1px solid #a1a1aa}.hover{border-style:dashed;border-color:#71717a}.handle{position:absolute;pointer-events:auto;width:10px;height:10px;min-height:0;padding:0;border:1px solid #09090b;background:#d4d4d8;border-radius:0;touch-action:none}.handle:hover{background:#fafafa}.handle::before{content:'';position:absolute;inset:-5px}[data-resize=n]{top:-5px;left:calc(50% - 5px);cursor:ns-resize}[data-resize=s]{bottom:-5px;left:calc(50% - 5px);cursor:ns-resize}[data-resize=e]{right:-5px;top:calc(50% - 5px);cursor:ew-resize}[data-resize=w]{left:-5px;top:calc(50% - 5px);cursor:ew-resize}.scale{right:-10px;bottom:-10px;width:20px;height:20px;min-height:0;padding:2px;border-radius:3px;cursor:nwse-resize;background:#fafafa;color:#09090b;touch-action:none}.toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);padding:8px 12px;border:1px solid #3f3f46;border-radius:6px;background:#18181b;max-width:calc(100vw - 100px)}
    @media(max-width:600px){.panel{right:12px;bottom:64px;width:min(288px,calc(100vw - 24px));max-height:60dvh}.panel.left{left:12px;right:auto}.toggle{right:12px;bottom:16px}.idle{right:12px;bottom:64px}}
  `;
  function mount(options = {}) {
    if (state) return api;
    if (!document.body) { if (!readyHandler) { readyHandler = () => { readyHandler = null; mount(options); }; document.addEventListener('DOMContentLoaded', readyHandler, { once: true }); } return api; }
    const host = document.createElement('in-app-editor'), root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<style>' + styles + '</style><div data-workspace class="workspace" tabindex="-1" hidden><div data-stage class="stage"><div data-page-copy></div></div></div><div class="app"><div data-hover class="outline hover" hidden></div><div data-selection class="outline" hidden>' + ['n', 'e', 's', 'w'].map((side) => '<button data-resize="' + side + '" class="handle" aria-label="Resize ' + ({ n: 'top', e: 'right', s: 'bottom', w: 'left' })[side] + '"></button>').join('') + '<button data-scale class="handle scale" aria-label="Scale item" title="Scale">' + icon('scale') + '</button></div><div data-idle class="idle" hidden>Click anywhere to edit</div><aside data-panel class="panel" aria-label="Page editor" hidden><header class="head"><span data-element class="element"></span><div class="actions"><button data-action="parent" aria-label="Select parent" title="Parent">' + icon('parent') + '</button><button data-action="move" aria-label="Move controls left" title="Move controls">' + icon('side') + '</button><button data-action="undo" aria-label="Undo" title="Undo" disabled>' + icon('undo') + '</button><button data-action="redo" aria-label="Redo" title="Redo" disabled>' + icon('redo') + '</button></div></header><div data-fields class="fields"></div><footer class="foot"><span data-count class="count" aria-label="Changed items"></span><button class="plain" data-action="reset">Reset</button><button class="plain" data-action="download">Export</button><button class="copy" data-action="copy">Copy changes</button></footer><div class="fallback"><textarea data-copy-fallback aria-label="Changes to copy" hidden></textarea></div></aside><button data-toggle class="toggle" aria-label="Edit page" aria-expanded="false">EDIT</button><div data-toast class="toast" role="status" hidden></div></div>';
    document.body.append(host);
    const canvas = root.querySelector('[data-page-copy]').attachShadow({ mode: 'open' });
    state = { host, root, canvas, options, abort: new AbortController(), changes: new Map(), layers: new Map(), copies: new WeakMap(), sources: new WeakMap(), past: [], future: [], active: false, selected: null, hovered: null, typing: null, gesture: null, frame: 0, toastTimer: 0, key: options.storageKey || 'in-app-editor:v2:' + location.pathname };
    if (options.persist !== false) { try { const saved = JSON.parse(localStorage.getItem(state.key)); if (saved?.version === 2 && Array.isArray(saved.changes)) for (const record of saved.changes) { if (record && typeof record.selector === 'string' && record.styles && record.attributes && record.textNodes && typeof record.beforeStyle === 'string') state.changes.set(record.selector, record); } } catch {} }
    const signal = state.abort.signal, workspace = root.querySelector('[data-workspace]');
    canvas.addEventListener('pointerdown', onPointerDown, { capture: true, signal }); canvas.addEventListener('click', (event) => { if (!state.typing?.element.contains(event.target)) block(event); }, { capture: true, signal });
    canvas.addEventListener('pointerover', (event) => { if (!state.gesture && !state.typing) { state.hovered = editable(event.target) ? event.target : null; scheduleDraw(); } }, { signal }); canvas.addEventListener('submit', block, { capture: true, signal });
    workspace.addEventListener('pointermove', moveGesture, { capture: true, signal }); workspace.addEventListener('pointerup', () => endGesture(), { capture: true, signal }); workspace.addEventListener('pointercancel', () => endGesture(true), { capture: true, signal });
    root.querySelectorAll('[data-resize]').forEach((handle) => handle.addEventListener('pointerdown', (event) => beginGesture(event, handle.dataset.resize), { signal })); root.querySelector('[data-scale]').addEventListener('pointerdown', (event) => beginGesture(event, 'scale'), { signal }); root.querySelector('[data-toggle]').addEventListener('click', () => setActive(!state.active), { signal });
    document.addEventListener('keydown', onKey, { capture: true, signal }); window.addEventListener('scroll', scheduleDraw, { capture: true, passive: true, signal }); window.addEventListener('resize', scheduleDraw, { passive: true, signal });
    root.addEventListener('click', (event) => {
      const target = event.target.closest('button'); if (!target) return;
      const actions = { undo, redo, reset, copy: copyChanges, download, parent: () => { if (state.selected) select(sourceOf(state.selected).parentElement); }, move: () => { const left = root.querySelector('[data-panel]').classList.toggle('left'); target.setAttribute('aria-label', left ? 'Move controls right' : 'Move controls left'); } }; actions[target.dataset.action]?.();
    }, { signal });
    root.addEventListener('change', (event) => {
      const target = event.target;
      if (target.dataset.style) { const property = target.dataset.style; let value = target.value.trim(); if (/^-?\d+(\.\d+)?$/.test(value) && !['opacity', 'font-weight', 'line-height', 'z-index', 'flex-grow', 'flex-shrink', 'order'].includes(property)) value += 'px'; const valid = setStyle(property, value); target.setAttribute('aria-invalid', String(!valid)); if (valid) target.value = value; }
      if (target.hasAttribute('data-text')) setText(target.value); if (target.hasAttribute('data-text-node')) setTextNode(Number(target.dataset.textNode), target.value); if (target.dataset.attribute) target.setAttribute('aria-invalid', String(!setAttribute(target.dataset.attribute, target.value)));
      if (target.dataset.frame && state.selected) { const value = Number(target.value), layer = layerFor(state.selected); if (!Number.isFinite(value) || (target.dataset.frame === 'scale' && value < .02)) return; remember(); const record = recordFor(state.selected); setFrame(layer, { ...frameFor(layer), [target.dataset.frame]: value }); record.frame = frameFor(layer); save(); }
    }, { signal });
    root.addEventListener('submit', (event) => { if (!event.target.matches('[data-custom]')) return; event.preventDefault(); const values = new FormData(event.target); if (setStyle(values.get('property'), values.get('value'))) renderPanel(); }, { signal });
    save(); if (options.open) setActive(true); return api;
  }
  function destroy() { if (readyHandler) { document.removeEventListener('DOMContentLoaded', readyHandler); readyHandler = null; } if (!state) return; finishText(); endGesture(true); state.abort.abort(); clearTimeout(state.toastTimer); cancelAnimationFrame(state.frame); state.host.remove(); state = null; }
  const api = Object.freeze({ mount, destroy, open: () => setActive(true), close: () => setActive(false), toggle: () => setActive(!state?.active), select, setStyle, setText, setTextNode, setAttribute, moveTo, undo, redo, reset, getChanges, exportChanges, version: '0.2.0' });
  window.InAppEditor = api;
  if (script && script.dataset.auto !== 'false') mount({ persist: script.dataset.persist !== 'false', open: script.dataset.open === 'true' });
})();
