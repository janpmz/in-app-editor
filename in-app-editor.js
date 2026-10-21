/* In-App Editor · MIT · https://github.com/janpmz/in-app-editor */
(function () {
  'use strict';
  if (typeof window === 'undefined' || window.InAppEditor) return;

  const script = document.currentScript;
  const forbidden = 'script,style,link,meta,head,title,noscript,template';
  const noText = 'input,textarea,select,img,iframe,video,audio,canvas,svg,path,br,hr';
  const styleFields = [
    ['Size', [['width', 'Width'], ['height', 'Height'], ['min-width', 'Min width'], ['max-width', 'Max width']]],
    ['Text', [['font-size', 'Font size'], ['line-height', 'Line height'], ['font-weight', 'Weight'], ['letter-spacing', 'Letter space']]],
    ['Space', [['padding-top', 'Pad top'], ['padding-right', 'Pad right'], ['padding-bottom', 'Pad bottom'], ['padding-left', 'Pad left'], ['margin-top', 'Margin top'], ['margin-right', 'Margin right'], ['margin-bottom', 'Margin bottom'], ['margin-left', 'Margin left'], ['gap', 'Gap']]],
    ['Shape', [['border-radius', 'Round corners'], ['border-width', 'Border width'], ['border-color', 'Border color'], ['opacity', 'Opacity']]]
  ];
  let state;
  let readyHandler;

  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  }

  function selectorFor(element) {
    if (element.id && document.querySelectorAll('#' + CSS.escape(element.id)).length === 1) return '#' + CSS.escape(element.id);
    for (const name of ['data-testid', 'data-edit-id']) {
      if (!element.hasAttribute(name)) continue;
      const selector = '[' + name + '="' + CSS.escape(element.getAttribute(name)) + '"]';
      if (document.querySelectorAll(selector).length === 1) return selector;
    }
    const parts = [];
    let current = element;
    while (current && current !== document.documentElement) {
      if (current.id && document.querySelectorAll('#' + CSS.escape(current.id)).length === 1) {
        parts.unshift('#' + CSS.escape(current.id));
        break;
      }
      const tag = CSS.escape(current.localName);
      const siblings = current.parentElement ? [...current.parentElement.children].filter((child) => child.localName === current.localName) : [];
      parts.unshift(tag + (siblings.length > 1 ? ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')' : ''));
      current = current.parentElement;
    }
    return parts.join(' > ');
  }

  function find(record) {
    try {
      const element = document.querySelector(record.selector);
      return element && element.localName === record.tag && !state.host.contains(element) ? element : null;
    } catch { return null; }
  }

  function editable(element) {
    return element instanceof Element && element !== document.documentElement && !state.host.contains(element) && !element.matches(forbidden) && Boolean(element.style);
  }

  function textAllowed(element) {
    return editable(element) && element.childElementCount === 0 && !element.matches(noText) && !element.closest('[contenteditable="true"]');
  }

  function snapshot() { return JSON.stringify([...state.changes.values()]); }
  function remember() {
    state.past.push(snapshot());
    if (state.past.length > 100) state.past.shift();
    state.future = [];
  }
  function recordFor(element) {
    const selector = selectorFor(element);
    if (!state.changes.has(selector)) state.changes.set(selector, { selector, tag: element.localName, beforeStyle: element.getAttribute('style'), styles: {}, attributes: {}, textNodes: {} });
    return state.changes.get(selector);
  }
  function prune(record) {
    if (!Object.keys(record.styles).length && !Object.keys(record.attributes).length && !Object.keys(record.textNodes || {}).length && !record.text) state.changes.delete(record.selector);
  }
  function applyStyles(record, element, reverse = false) {
    if (!Object.keys(record.styles).length) return;
    if (reverse && record.beforeStyle !== undefined) {
      if (record.beforeStyle === null) element.removeAttribute('style');
      else element.setAttribute('style', record.beforeStyle);
      return;
    }
    const next = document.createElement('div').style;
    next.cssText = element.style.cssText;
    for (const [property, change] of Object.entries(record.styles)) {
      const value = reverse ? change.before : change.after;
      if (value) next.setProperty(property, value, reverse ? change.priority : 'important');
      else next.removeProperty(property);
    }
    if (next.cssText !== element.style.cssText) element.style.cssText = next.cssText;
  }
  function applyRecord(record, reverse = false) {
    const element = find(record);
    if (!element) return;
    applyStyles(record, element, reverse);
    if (record.text && element.childElementCount === 0) {
      const value = reverse ? record.text.before : record.text.after;
      if (element.textContent !== value) element.textContent = value;
    }
    for (const [index, change] of Object.entries(record.textNodes || {})) {
      const node = element.childNodes[Number(index)];
      const value = reverse ? change.before : change.after;
      if (node?.nodeType === Node.TEXT_NODE && node.textContent !== value) node.textContent = value;
    }
    for (const [name, change] of Object.entries(record.attributes)) {
      const value = reverse ? change.before : change.after;
      if (value === null) element.removeAttribute(name);
      else if (element.getAttribute(name) !== value) element.setAttribute(name, value);
    }
  }
  function save() {
    if (state.options.persist !== false) {
      try { localStorage.setItem(state.key, JSON.stringify({ version: 1, changes: [...state.changes.values()] })); }
      catch { toast('Browser storage is full or off. Use Copy changes to keep your work.'); }
    }
    const count = state.changes.size;
    state.root.querySelector('[data-count]').textContent = count ? count + (count === 1 ? ' change' : ' changes') : 'No changes yet';
    state.root.querySelector('[data-action="undo"]').disabled = !state.past.length;
    state.root.querySelector('[data-action="redo"]').disabled = !state.future.length;
    state.options.onChange?.(getChanges());
    draw();
  }
  function setStyle(property, value, element = state?.selected, history = true) {
    if (!state || !editable(element)) return false;
    property = String(property).trim().toLowerCase();
    value = String(value).trim();
    if (!/^([a-z][a-z-]*|--[\w-]+)$/.test(property) || (value && !CSS.supports(property, value))) return false;
    if (element.style.getPropertyValue(property) === value) return true;
    if (history) remember();
    const record = recordFor(element);
    const change = record.styles[property] || { before: element.style.getPropertyValue(property), priority: element.style.getPropertyPriority(property), after: '' };
    delete record.styles[property];
    record.styles[property] = change;
    if (value) element.style.setProperty(property, value, 'important');
    else element.style.removeProperty(property);
    value = element.style.getPropertyValue(property);
    record.styles[property].after = value;
    if (value === record.styles[property].before) {
      element.style.setProperty(property, value, record.styles[property].priority);
      delete record.styles[property];
    }
    if (['width', 'height'].includes(property) && value && getComputedStyle(element).display === 'inline') setStyle('display', 'inline-block', element, false);
    prune(record);
    if (history) save();
    return true;
  }
  function setText(value, element = state?.selected) {
    if (!state || !textAllowed(element)) return false;
    value = String(value);
    if (element.textContent === value) return true;
    remember();
    const record = recordFor(element);
    record.text ||= { before: element.textContent, after: '' };
    record.text.after = value;
    element.textContent = value;
    if (value === record.text.before) delete record.text;
    prune(record);
    save();
    return true;
  }
  function setTextNode(index, value, element = state?.selected) {
    if (!state || !editable(element)) return false;
    const node = element.childNodes[index];
    if (node?.nodeType !== Node.TEXT_NODE || element.matches(noText)) return false;
    value = String(value);
    if (node.textContent === value) return true;
    remember();
    const record = recordFor(element);
    record.textNodes ||= {};
    record.textNodes[index] ||= { before: node.textContent, after: '' };
    record.textNodes[index].after = value;
    node.textContent = value;
    if (value === record.textNodes[index].before) delete record.textNodes[index];
    prune(record);
    save();
    return true;
  }
  function setAttribute(name, value, element = state?.selected) {
    if (!state || !editable(element) || !['src', 'alt', 'href', 'title'].includes(name)) return false;
    value = value === null ? null : String(value);
    if (['src', 'href'].includes(name) && value) {
      try {
        const url = new URL(value, document.baseURI);
        if (!['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol)) return false;
      } catch { return false; }
    }
    if (element.getAttribute(name) === value) return true;
    remember();
    const record = recordFor(element);
    record.attributes[name] ||= { before: element.getAttribute(name), after: null };
    record.attributes[name].after = value;
    if (value === null) element.removeAttribute(name); else element.setAttribute(name, value);
    if (value === record.attributes[name].before) delete record.attributes[name];
    prune(record);
    save();
    return true;
  }
  function loadHistory(value) {
    for (const record of state.changes.values()) applyRecord(record, true);
    state.changes = new Map(JSON.parse(value).map((record) => [record.selector, record]));
    for (const record of state.changes.values()) applyRecord(record);
    save();
    renderPanel();
  }
  function undo() {
    finishText();
    if (!state?.past.length) return;
    state.future.push(snapshot());
    loadHistory(state.past.pop());
  }
  function redo() {
    finishText();
    if (!state?.future.length) return;
    state.past.push(snapshot());
    loadHistory(state.future.pop());
  }
  function reset() {
    finishText();
    if (!state?.changes.size) return;
    remember();
    for (const record of state.changes.values()) applyRecord(record, true);
    state.changes.clear();
    save();
    renderPanel();
    toast('Changes cleared. Undo brings them back.');
  }
  function getChanges() {
    if (!state) return [];
    return [...state.changes.values()].map((record) => ({
      selector: record.selector, tag: record.tag,
      ...(record.text ? { text: { ...record.text } } : {}),
      ...(Object.keys(record.textNodes || {}).length ? { textNodes: JSON.parse(JSON.stringify(record.textNodes)) } : {}),
      ...(Object.keys(record.styles).length ? { styles: Object.fromEntries(Object.entries(record.styles).map(([key, value]) => [key, value.after])) } : {}),
      ...(Object.keys(record.attributes).length ? { attributes: Object.fromEntries(Object.entries(record.attributes).map(([key, value]) => [key, value.after])) } : {})
    }));
  }
  function exportChanges(format = 'prompt') {
    finishText();
    const changes = getChanges();
    if (format === 'json') return JSON.stringify({ version: 1, page: location.pathname, changes }, null, 2);
    const css = changes.filter((change) => change.styles).map((change) => change.selector + ' {\n' + Object.entries(change.styles).map(([property, value]) => '  ' + property + ': ' + (value || 'initial') + ' !important;').join('\n') + '\n}').join('\n\n');
    if (format === 'css') return css;
    return 'Apply these edits to the website source files. I made them with In-App Editor on ' + location.pathname + '.\nFind each element from its selector and its old text. Update the matching component or page and its styles. Keep the site’s current layout rules and behavior. Use the site’s existing style system where possible. Check the result at wide and narrow widths. These browser edits do not yet change the source files.\n\n' + JSON.stringify(changes, null, 2);
  }

  function field(property, label, value) {
    return '<label>' + label + '<input data-style="' + property + '" aria-label="' + label + '" value="' + escapeHTML(value) + '" spellcheck="false"></label>';
  }
  function selectField(property, label, values, current) {
    const all = values.includes(current) ? values : [current, ...values];
    return '<label>' + label + '<select data-style="' + property + '" aria-label="' + label + '">' + all.map((value) => '<option' + (value === current ? ' selected' : '') + '>' + escapeHTML(value) + '</option>').join('') + '</select></label>';
  }
  function renderPanel() {
    if (!state) return;
    const panel = state.root.querySelector('[data-fields]');
    const element = state.selected;
    if (!element?.isConnected) {
      state.selected = null;
      state.root.querySelector('[data-element]').textContent = 'Pick anything';
      panel.innerHTML = '<div class="empty"><span class="cross">↖</span><h2>Your site. Your call.</h2><p>Click any text, button, image or box. Then make it yours.</p><div class="tip">Double-click words to type.<br>Drag a white handle to resize.<br>Use Parent to pick a larger box.</div></div>';
      draw();
      return;
    }
    const css = getComputedStyle(element);
    state.root.querySelector('[data-element]').textContent = element.localName + (element.id ? '#' + element.id : '');
    let html = '<div class="picked"><code title="' + escapeHTML(selectorFor(element)) + '">' + escapeHTML(selectorFor(element)) + '</code><button data-action="parent" title="Select the parent box">↑ Parent</button></div>';
    if (textAllowed(element)) html += '<section><label>Words<textarea data-text aria-label="Words" rows="3">' + escapeHTML(element.textContent) + '</textarea></label></section>';
    else if (!element.matches(noText)) {
      const nodes = [...element.childNodes].map((node, index) => ({ node, index })).filter(({ node }) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
      if (nodes.length) html += '<section><h3>Words</h3>' + nodes.map(({ node, index }, order) => '<label>Text part ' + (order + 1) + '<textarea data-text-node="' + index + '" aria-label="Text part ' + (order + 1) + '" rows="2">' + escapeHTML(node.textContent) + '</textarea></label>').join('') + '<p class="hint">Each field keeps the other items in this box in place.</p></section>';
    }
    if (element.matches('img')) html += '<section>' + ['src', 'alt'].map((name) => '<label>' + (name === 'src' ? 'Image URL' : 'Image description') + '<input data-attribute="' + name + '" aria-label="' + (name === 'src' ? 'Image URL' : 'Image description') + '" value="' + escapeHTML(element.getAttribute(name) || '') + '"></label>').join('') + '</section>';
    if (element.matches('a')) html += '<section><label>Link URL<input data-attribute="href" aria-label="Link URL" value="' + escapeHTML(element.getAttribute('href') || '') + '"></label></section>';
    html += '<section><h3>Color</h3><div class="grid">' + field('color', 'Text color', css.color) + field('background-color', 'Fill color', css.backgroundColor) + '</div><div class="swatches">' + ['#22231f', '#ffffff', '#eff1e8', '#e2ff70', '#b5c3ff', '#ffa777', 'transparent'].map((color) => '<button class="swatch" data-color="' + color + '" style="--swatch:' + color + '" aria-label="Fill ' + color + '" title="Fill ' + color + '"></button>').join('') + '</div></section>';
    for (const [title, fields] of styleFields) {
      html += '<section><h3>' + title + '</h3>';
      if (title === 'Text') html += '<label>Font<input data-style="font-family" aria-label="Font" value="' + escapeHTML(css.fontFamily) + '"></label>';
      html += '<div class="grid">' + fields.map(([property, label]) => field(property, label, css.getPropertyValue(property))).join('') + '</div>';
      if (title === 'Text') html += selectField('text-align', 'Align text', ['left', 'center', 'right', 'justify'], css.textAlign);
      html += '</section>';
    }
    html += '<section><h3>Layout</h3><div class="grid">' + selectField('display', 'Display', ['block', 'inline', 'inline-block', 'flex', 'grid', 'none'], css.display) + selectField('flex-direction', 'Direction', ['row', 'column', 'row-reverse', 'column-reverse'], css.flexDirection) + selectField('justify-content', 'Main axis', ['normal', 'flex-start', 'center', 'flex-end', 'space-between', 'space-around'], css.justifyContent) + selectField('align-items', 'Cross axis', ['normal', 'stretch', 'flex-start', 'center', 'flex-end'], css.alignItems) + field('grid-template-columns', 'Grid columns', css.gridTemplateColumns) + '</div></section>';
    html += '<section><h3>Any style</h3><p class="hint">For a change the fields above do not cover.</p><form data-custom><div class="grid"><label>Property<input name="property" aria-label="Style property" placeholder="box-shadow" required></label><label>Value<input name="value" aria-label="Style value" placeholder="0 8px 24px #0002" required></label></div><button class="wide" type="submit">Apply style</button></form></section>';
    panel.innerHTML = html;
    draw();
  }
  function select(element) {
    if (!state || !editable(element)) return false;
    finishText();
    state.selected = element;
    state.selectedSelector = selectorFor(element);
    renderPanel();
    return true;
  }
  function drawBox(box, element) {
    if (!element?.isConnected || !element.getClientRects().length) { box.hidden = true; return; }
    const rect = element.getBoundingClientRect();
    box.hidden = rect.width === 0 && rect.height === 0;
    Object.assign(box.style, { left: rect.left + 'px', top: rect.top + 'px', width: rect.width + 'px', height: rect.height + 'px' });
  }
  function draw() {
    if (!state) return;
    const active = state.active;
    const selected = state.root.querySelector('[data-selection]');
    const hover = state.root.querySelector('[data-hover]');
    if (active) {
      drawBox(selected, state.selected);
      drawBox(hover, state.hovered === state.selected ? null : state.hovered);
    } else { selected.hidden = hover.hidden = true; }
    if (state.selected?.isConnected) {
      const rect = state.selected.getBoundingClientRect();
      state.root.querySelector('[data-size]').textContent = Math.round(rect.width) + ' × ' + Math.round(rect.height);
    }
  }
  function scheduleDraw() {
    if (!state || state.frame) return;
    state.frame = requestAnimationFrame(() => { if (state) { state.frame = 0; draw(); } });
  }
  function toast(message) {
    if (!state) return;
    const note = state.root.querySelector('[data-toast]');
    note.textContent = message;
    note.hidden = false;
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => { note.hidden = true; }, 4500);
  }
  function finishText() {
    if (!state?.typing) return;
    const { element, before, editableValue, spellcheck } = state.typing;
    const after = element.textContent;
    state.typing = null;
    if (editableValue === null) element.removeAttribute('contenteditable'); else element.setAttribute('contenteditable', editableValue);
    if (spellcheck === null) element.removeAttribute('spellcheck'); else element.setAttribute('spellcheck', spellcheck);
    element.textContent = before;
    setText(after, element);
  }
  function startText(element) {
    if (!textAllowed(element)) return;
    finishText();
    state.typing = { element, before: element.textContent, editableValue: element.getAttribute('contenteditable'), spellcheck: element.getAttribute('spellcheck') };
    element.setAttribute('contenteditable', 'plaintext-only');
    element.setAttribute('spellcheck', 'true');
    element.focus();
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    element.addEventListener('blur', finishText, { once: true, signal: state.abort.signal });
    toast('Type your words. Click elsewhere to save.');
  }
  function setActive(active) {
    if (!state) return;
    finishText();
    state.active = Boolean(active);
    state.hovered = null;
    state.root.querySelector('[data-panel]').hidden = !state.active;
    const button = state.root.querySelector('[data-toggle]');
    button.setAttribute('aria-expanded', String(state.active));
    button.innerHTML = state.active ? '<span class="status"></span> DONE <span class="key">Esc</span>' : '<span class="edit-icon">↗</span> EDIT';
    draw();
  }
  function isUI(event) { return event.composedPath().includes(state.host); }
  function block(event) { event.preventDefault(); event.stopImmediatePropagation(); }
  function onPointerDown(event) {
    if (!state.active || isUI(event) || state.typing?.element.contains(event.target)) return;
    if (!editable(event.target)) return;
    block(event);
    select(event.target);
  }
  function onClick(event) {
    if (!state.active || isUI(event) || state.typing?.element.contains(event.target)) return;
    block(event);
    if (editable(event.target)) select(event.target);
  }
  function onDoubleClick(event) {
    if (!state.active || isUI(event) || !editable(event.target)) return;
    block(event);
    select(event.target);
    startText(event.target);
  }
  function onKey(event) {
    if (!state.active) return;
    const target = event.composedPath()[0];
    const typing = target?.matches?.('input,textarea,select,[contenteditable]');
    if (event.key === 'Escape') {
      event.preventDefault();
      if (state.typing) { finishText(); renderPanel(); }
      else setActive(false);
    } else if (!typing && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
      block(event);
      if (event.shiftKey) redo(); else undo();
    } else if (!typing && event.altKey && event.key === 'ArrowUp' && state.selected?.parentElement) {
      block(event);
      select(state.selected.parentElement);
    }
  }
  async function copyChanges() {
    const text = exportChanges();
    try { await navigator.clipboard.writeText(text); toast('Copied. Paste into Codex to save these edits in your files.'); }
    catch {
      const area = state.root.querySelector('[data-copy-fallback]');
      area.hidden = false;
      area.value = text;
      area.focus();
      area.select();
      toast('Select and copy the changes below.');
    }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([exportChanges('json')], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'in-app-editor-changes.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function resize(event) {
    if (!state.selected || event.button !== 0) return;
    event.preventDefault();
    finishText();
    const element = state.selected;
    const handle = event.currentTarget;
    const direction = handle.dataset.resize;
    const css = getComputedStyle(element);
    const width = parseFloat(css.width) || element.getBoundingClientRect().width;
    const height = parseFloat(css.height) || element.getBoundingClientRect().height;
    const startX = event.clientX, startY = event.clientY;
    remember();
    handle.setPointerCapture(event.pointerId);
    const move = (next) => {
      if (direction.includes('e')) setStyle('width', Math.max(8, Math.round(width + next.clientX - startX)) + 'px', element, false);
      if (direction.includes('s')) setStyle('height', Math.max(8, Math.round(height + next.clientY - startY)) + 'px', element, false);
      draw();
    };
    const end = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      save();
      renderPanel();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }

  const styles = `
    :host { all: initial !important; position: fixed !important; inset: 0 !important; z-index: 2147483647 !important; pointer-events: none !important; color-scheme: light !important; }
    *,*::before,*::after { box-sizing: border-box; }
    [hidden] { display:none !important; }
    .app { font: 13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; color:#252820; letter-spacing:0; text-align:left; }
    button,input,textarea,select { font:inherit; color:inherit; }
    button { cursor:pointer; border:1px solid #dcded6; background:#fff; border-radius:7px; padding:7px 10px; line-height:1.3; }
    button:hover { background:#f0f2e9; border-color:#bfc5b2; }
    button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible { outline:2px solid #687e25; outline-offset:2px; }
    button:disabled { opacity:.35; cursor:default; }
    .toggle { pointer-events:auto; position:fixed; bottom:22px; right:22px; display:flex; align-items:center; gap:10px; background:#e2ff70; color:#252820; border:1px solid #bdcf75; border-radius:999px; padding:13px 19px; font-size:12px; font-weight:800; letter-spacing:1.2px; box-shadow:0 4px 20px #1c24151c; }
    .toggle:hover { background:#d8f366; }
    .edit-icon { font-size:20px; line-height:14px; }
    .key { font-size:10px; font-weight:500; letter-spacing:0; opacity:.55; border:1px solid currentColor; padding:1px 4px; border-radius:4px; }
    .status { width:7px; height:7px; border-radius:50%; background:#566d12; }
    .panel { pointer-events:auto; position:fixed; right:22px; bottom:82px; width:320px; max-height:calc(100dvh - 108px); background:#fbfcf7; border:1px solid #d9ddce; border-radius:14px; box-shadow:0 12px 60px #1f291f26; overflow:hidden; display:flex; flex-direction:column; }
    .panel.left { left:22px; right:auto; }
    .head { display:flex; align-items:center; justify-content:space-between; padding:17px 17px 13px; border-bottom:1px solid #e4e7dc; gap:12px; }
    .head > div:first-child { min-width:0; flex:1; }
    .brand { font-size:10px; font-weight:700; letter-spacing:1.8px; color:#6d7561; text-transform:uppercase; }
    .element { font-size:16px; font-weight:650; max-width:190px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-top:3px; }
    .history { display:flex; gap:4px; flex-shrink:0; }
    .history button { font-size:18px; padding:3px 9px; }
    .fields { overflow-y:auto; overscroll-behavior:contain; min-height:100px; scrollbar-width:thin; }
    section { padding:14px 17px; border-bottom:1px solid #e4e7dc; }
    h3 { margin:0 0 10px; font-size:10px; font-weight:750; text-transform:uppercase; letter-spacing:1.3px; color:#707760; }
    label { display:block; font-size:11px; color:#6a715f; }
    input,select,textarea { display:block; width:100%; min-width:0; border:1px solid #dce0d2; border-radius:6px; background:#fff; padding:8px; margin:5px 0 0; font-size:12px; color:#252820; }
    textarea { resize:vertical; min-height:66px; line-height:1.5; }
    input[aria-invalid=true] { border-color:#cc523d; }
    .grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
    label + .grid,.grid + label { margin-top:10px; }
    section > label + label { margin-top:10px; }
    .picked { display:flex; align-items:center; gap:8px; padding:11px 17px; background:#f0f3e8; }
    code { flex:1; min-width:0; font:10px/1.5 ui-monospace,monospace; white-space:nowrap; text-overflow:ellipsis; overflow:hidden; color:#778263; }
    .picked button { flex-shrink:0; font-size:10px; padding:5px 7px; }
    .swatches { display:flex; gap:8px; margin-top:12px; }
    .swatch { width:23px; height:23px; border-radius:50%; background:var(--swatch); border:1px solid #25282025; padding:0; }
    .swatch:hover { background:var(--swatch); outline:2px solid #a5b87a; outline-offset:2px; }
    .foot { padding:12px 17px; border-top:1px solid #dce0d2; background:#f6f8ef; }
    .foot-row { display:flex; align-items:center; justify-content:space-between; gap:7px; }
    .count { font-size:10px; color:#737b64; }
    .plain { border:0; background:none; padding:3px; color:#78826a; font-size:10px; }
    .copy { display:block; width:100%; margin-top:9px; background:#272e20; color:#f6f8ef; border-color:#272e20; padding:10px; font-size:12px; font-weight:600; }
    .copy:hover { background:#3d4930; color:#fff; }
    .hint { font-size:11px; line-height:1.5; color:#7b826e; margin:5px 0 10px; }
    .foot .hint { margin:7px 0 0; text-align:center; font-size:10px; }
    .wide { width:100%; margin-top:10px; }
    .empty { padding:30px 23px 36px; }
    .cross { font-size:32px; color:#899b62; }
    h2 { font-size:22px; letter-spacing:-.6px; font-weight:600; margin:14px 0 10px; }
    .empty p { color:#7b826e; font-size:13px; line-height:1.7; margin:0; }
    .tip { border-top:1px solid #e4e7dc; margin-top:23px; padding-top:17px; color:#879177; font-size:11px; line-height:1.9; }
    .outline { position:fixed; pointer-events:none; border:2px solid #9dba45; border-radius:2px; }
    .hover { border:1px dashed #9dba45; background:#d9f59308; }
    .size { position:absolute; left:-2px; bottom:calc(100% + 4px); padding:3px 6px; background:#374827; color:#f7ffe4; border-radius:4px; font:10px/1.3 ui-monospace,monospace; white-space:nowrap; }
    .handle { pointer-events:auto; position:absolute; width:10px; height:10px; padding:0; border:1px solid #718d32; border-radius:2px; background:#fff; }
    .handle:hover { background:#e2ff70; }
    [data-resize=e] { right:-6px; top:calc(50% - 5px); cursor:ew-resize; }
    [data-resize=s] { bottom:-6px; left:calc(50% - 5px); cursor:ns-resize; }
    [data-resize=se] { right:-6px; bottom:-6px; cursor:nwse-resize; }
    .toast { pointer-events:auto; position:fixed; bottom:24px; left:50%; transform:translateX(-50%); max-width:min(440px,calc(100vw - 32px)); background:#272e20; color:#f6f8ef; padding:12px 17px; border-radius:10px; box-shadow:0 4px 30px #2223; font-size:12px; }
    @media (max-width:600px) { .panel.left { left:10px; right:auto; } .panel { right:10px; bottom:76px; width:min(300px,calc(100vw - 20px)); max-height:65dvh; } .toggle { right:12px; bottom:16px; } .toast { bottom:76px; width:calc(100vw - 24px); } }
    @media (prefers-reduced-motion:no-preference) { button { transition:background .12s,border-color .12s; } }
  `;

  function mount(options = {}) {
    if (state) return api;
    if (!document.body) {
      if (!readyHandler) {
        readyHandler = () => { readyHandler = null; mount(options); };
        document.addEventListener('DOMContentLoaded', readyHandler, { once: true });
      }
      return api;
    }
    const host = document.createElement('in-app-editor');
    host.setAttribute('data-in-app-editor', '');
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<style>' + styles + '</style><div class="app"><div data-hover class="outline hover" hidden></div><div data-selection class="outline" hidden><span data-size class="size"></span><button data-resize="e" class="handle" aria-label="Resize width"></button><button data-resize="s" class="handle" aria-label="Resize height"></button><button data-resize="se" class="handle" aria-label="Resize width and height"></button></div><aside data-panel class="panel" aria-label="Page editor" hidden><header class="head"><div><div class="brand">In-App Editor</div><div data-element class="element">Pick anything</div></div><div class="history"><button data-action="move" aria-label="Move controls left" title="Move controls to the other side">↔</button><button data-action="undo" aria-label="Undo" title="Undo (⌘/Ctrl Z)" disabled>↶</button><button data-action="redo" aria-label="Redo" title="Redo (⌘/Ctrl Shift Z)" disabled>↷</button></div></header><div data-fields class="fields"></div><footer class="foot"><div class="foot-row"><span data-count class="count">No changes yet</span><div><button class="plain" data-action="download">Export</button> · <button class="plain" data-action="reset">Reset</button></div></div><button data-action="copy" class="copy">Copy changes ↗</button><p class="hint">Paste into Codex to save in your site’s files.</p><textarea data-copy-fallback aria-label="Changes to copy" hidden></textarea></footer></aside><button data-toggle class="toggle" aria-label="Toggle page editor" aria-expanded="false"><span class="edit-icon">↗</span> EDIT</button><div data-toast class="toast" role="status" aria-live="polite" hidden></div></div>';
    document.body.append(host);
    state = { host, root, options, abort: new AbortController(), changes: new Map(), past: [], future: [], selected: null, hovered: null, active: false, typing: null, frame: 0, restoreTimer: 0, toastTimer: 0, key: options.storageKey || 'in-app-editor:v1:' + location.pathname };
    const signal = state.abort.signal;
    if (options.persist !== false) {
      try {
        const saved = JSON.parse(localStorage.getItem(state.key));
        if (saved?.version === 1 && Array.isArray(saved.changes)) {
          for (const record of saved.changes) {
            if (record && typeof record.selector === 'string' && typeof record.tag === 'string' && record.styles && record.attributes) {
              state.changes.set(record.selector, record);
              applyRecord(record);
            }
          }
        }
      } catch { /* Storage may be off or contain an old draft. */ }
    }
    document.addEventListener('pointerdown', onPointerDown, { capture: true, signal });
    document.addEventListener('click', onClick, { capture: true, signal });
    document.addEventListener('dblclick', onDoubleClick, { capture: true, signal });
    document.addEventListener('submit', (event) => { if (state.active && !isUI(event)) block(event); }, { capture: true, signal });
    document.addEventListener('pointerover', (event) => {
      if (!state.active || isUI(event) || state.typing) return;
      state.hovered = editable(event.target) ? event.target : null;
      scheduleDraw();
    }, { capture: true, signal });
    document.addEventListener('keydown', onKey, { capture: true, signal });
    document.addEventListener('paste', (event) => {
      if (!state.typing || !state.typing.element.contains(event.target)) return;
      event.preventDefault();
      const selection = window.getSelection();
      if (!selection.rangeCount) return;
      const range = selection.getRangeAt(0);
      range.deleteContents();
      const text = document.createTextNode(event.clipboardData.getData('text/plain'));
      range.insertNode(text);
      range.setStartAfter(text);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    }, { capture: true, signal });
    window.addEventListener('scroll', scheduleDraw, { capture: true, passive: true, signal });
    window.addEventListener('resize', scheduleDraw, { passive: true, signal });
    root.querySelector('[data-toggle]').addEventListener('click', () => setActive(!state.active), { signal });
    root.addEventListener('click', (event) => {
      const target = event.target.closest('button');
      if (!target) return;
      const actions = { undo, redo, reset, copy: copyChanges, download, move: () => { const left = root.querySelector('[data-panel]').classList.toggle('left'); target.setAttribute('aria-label', left ? 'Move controls right' : 'Move controls left'); }, parent: () => { if (state.selected) select(state.selected.parentElement); } };
      if (target.dataset.action) actions[target.dataset.action]?.();
      if (target.dataset.color) { setStyle('background-color', target.dataset.color); renderPanel(); }
    }, { signal });
    root.addEventListener('change', (event) => {
      const target = event.target;
      if (target.dataset.style) {
        const property = target.dataset.style;
        let value = target.value.trim();
        if (/^-?\d+(\.\d+)?$/.test(value) && !['opacity', 'font-weight', 'line-height', 'z-index', 'flex-grow', 'flex-shrink', 'order'].includes(property)) value += 'px';
        const valid = setStyle(property, value);
        target.setAttribute('aria-invalid', String(!valid));
        if (valid) { target.value = value; draw(); }
        else toast('That value does not work. Try a size such as 24px or 50%.');
      }
      if (target.hasAttribute('data-text')) setText(target.value);
      if (target.hasAttribute('data-text-node')) setTextNode(Number(target.dataset.textNode), target.value);
      if (target.dataset.attribute && !setAttribute(target.dataset.attribute, target.value)) toast('Use a web address, mail link or phone link.');
    }, { signal });
    root.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!event.target.matches('[data-custom]')) return;
      const values = new FormData(event.target);
      if (setStyle(values.get('property'), values.get('value'))) { toast('Style applied.'); renderPanel(); }
      else toast('Check the style name and value.');
    }, { signal });
    root.querySelectorAll('[data-resize]').forEach((handle) => handle.addEventListener('pointerdown', resize, { signal }));
    state.observer = new MutationObserver((entries) => {
      if (!entries.some((entry) => !host.contains(entry.target))) return;
      scheduleDraw();
      if (state.restoreTimer || state.typing) return;
      state.restoreTimer = setTimeout(() => {
        if (!state) return;
        state.restoreTimer = 0;
        for (const record of state.changes.values()) {
          const element = find(record);
          if (!element) continue;
          applyStyles(record, element);
          if (record.text && element.childElementCount === 0 && element.textContent !== record.text.after) element.textContent = record.text.after;
          for (const [index, change] of Object.entries(record.textNodes || {})) {
            const node = element.childNodes[Number(index)];
            if (node?.nodeType === Node.TEXT_NODE && node.textContent !== change.after) node.textContent = change.after;
          }
          for (const [name, change] of Object.entries(record.attributes)) {
            if (element.getAttribute(name) !== change.after) {
              if (change.after === null) element.removeAttribute(name); else element.setAttribute(name, change.after);
            }
          }
          if (state.selected && !state.selected.isConnected && state.selectedSelector === record.selector) state.selected = element;
        }
      }, 80);
    });
    state.observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    renderPanel();
    save();
    if (options.open) setActive(true);
    return api;
  }
  function destroy({ revert = false } = {}) {
    if (readyHandler) { document.removeEventListener('DOMContentLoaded', readyHandler); readyHandler = null; }
    if (!state) return;
    finishText();
    state.observer.disconnect();
    state.abort.abort();
    clearTimeout(state.toastTimer);
    clearTimeout(state.restoreTimer);
    cancelAnimationFrame(state.frame);
    if (revert) for (const record of state.changes.values()) applyRecord(record, true);
    state.host.remove();
    state = null;
  }
  const api = Object.freeze({ mount, destroy, open: () => setActive(true), close: () => setActive(false), toggle: () => setActive(!state?.active), select, setStyle, setText, setTextNode, setAttribute, undo, redo, reset, getChanges, exportChanges, version: '0.1.0' });
  window.InAppEditor = api;
  if (script && script.dataset.auto !== 'false') mount({ persist: script.dataset.persist !== 'false', open: script.dataset.open === 'true' });
})();
