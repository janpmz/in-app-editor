import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createServer } from '../server.mjs';
import { comparePNG } from './pixels.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('browser checks', { timeout: 60000 }, async (t) => {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  const profile = await mkdtemp(path.join(tmpdir(), 'in-app-editor-test-'));
  const executable = process.env.CHROME_PATH || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome');
  const chrome = spawn(executable, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' });
  let launchError;
  chrome.on('error', (error) => { launchError = error; });
  let socket;
  t.after(async () => {
    socket?.close();
    chrome.kill();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await sleep(300);
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  });
  let port;
  for (let n = 0; n < 100; n++) {
    if (launchError) throw new Error('Chrome did not start. Set CHROME_PATH to its full path.', { cause: launchError });
    try { port = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; } catch { await sleep(100); }
  }
  assert.ok(port, 'Chrome should start');
  const targets = await fetch('http://127.0.0.1:' + port + '/json/list').then((result) => result.json());
  socket = new WebSocket(targets.find((target) => target.type === 'page').webSocketDebuggerUrl);
  await once(socket, 'open');
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const result = JSON.parse(event.data);
    if (!result.id || !pending.has(result.id)) return;
    const { resolve, reject, timer } = pending.get(result.id);
    pending.delete(result.id);
    clearTimeout(timer);
    if (result.error) reject(new Error(result.error.message)); else resolve(result.result);
  });
  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('Chrome took too long: ' + method)); }, 10000);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async function run(expression) {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }
  async function fresh(options = '{persist:false,open:true}') {
    await send('Page.navigate', { url: base + '/tests/fixture.html?run=' + Date.now() });
    for (let n = 0; n < 100; n++) {
      if (await run('document.readyState === "complete" && Boolean(window.InAppEditor)')) break;
      await sleep(20);
    }
    await run('window.editor=InAppEditor;window.sourceHTML=document.querySelector("#fixture").outerHTML;editor.mount({initialZoom:1,...' + options + '});window.copy=(selector)=>[...document.querySelector("in-app-editor").shadowRoot.querySelector("[data-page-copy]").shadowRoot.querySelectorAll(selector)].find(el=>!el.closest("[data-iae-placeholder]"));window.box=(el)=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}}');
  }
  async function click(selector, count = 1, original = false) {
    const point = await run(`(()=>{const r=${original ? "document.querySelector" : "copy"}(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: count });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: count });
  }

  async function drag(point, dx, dy) {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x + dx, y: point.y + dy, button: 'left', buttons: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x + dx, y: point.y + dy, button: 'left', clickCount: 1 });
  }
  async function handle(selector) {
    return run(`(()=>{const r=document.querySelector('in-app-editor').shadowRoot.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  }
  async function key(key, modifiers = 0) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key, modifiers });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, modifiers });
  }
  async function context(selector) {
    const point = await run(`(()=>{const r=copy(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+Math.min(10,r.width/2),y:r.y+Math.min(10,r.height/2)}})()`);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'right', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'right', clickCount: 1 });
  }
  async function action(name) {
    const point = await handle('[data-menu] [data-action="' + name + '"]');
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
  }
  async function addToSelection(selector) {
    const point = await run(`(()=>{const r=copy(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1, modifiers: 8 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1, modifiers: 8 });
  }
  async function sameSource() { assert.equal(await run('document.querySelector("#fixture").outerHTML'), await run('sourceHTML')); }
  async function uiClick(selector) {
    await run('document.querySelector("in-app-editor").shadowRoot.querySelector(' + JSON.stringify(selector) + ').click()');
  }
  async function uiValue(selector, value, type = 'change') {
    await run(`(()=>{const input=document.querySelector('in-app-editor').shadowRoot.querySelector(${JSON.stringify(selector)});input.value=${JSON.stringify(String(value))};input.dispatchEvent(new Event(${JSON.stringify(type)},{bubbles:true}));})()`);
  }
  async function layout() {
    await send('Page.navigate', { url: base + '/tests/layout.html' });
    for (let n=0;n<100;n++) { if (await run('document.readyState === "complete" && Boolean(window.InAppEditor)')) break; await sleep(20); }
    await run('window.editor=InAppEditor;editor.mount({persist:false,initialZoom:1});window.copy=(selector)=>document.querySelector("in-app-editor").shadowRoot.querySelector("[data-page-copy]").shadowRoot.querySelector(selector);window.box=(el)=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}}');
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 800, deviceScaleFactor: 1, mobile: false });
  await t.test('create all items before selection without placeholders', async () => {
    await fresh();
    const before = await run('document.querySelector("in-app-editor").shadowRoot.querySelector("[data-page-copy]").shadowRoot.querySelectorAll("[data-iae-layer]").length');
    assert.ok(before > 15);
    assert.equal(await run('Boolean(copy("#headline").parentElement.hasAttribute("data-iae-layer"))'), true);
    assert.equal(await run('Boolean(copy("#copy").parentElement.hasAttribute("data-iae-layer"))'), true);
    assert.equal(await run('document.querySelector("in-app-editor").shadowRoot.querySelector("[data-page-copy]").shadowRoot.querySelectorAll("[data-iae-placeholder]").length'), 0);
    await run('editor.select(document.querySelector("#headline"))');
    assert.equal(await run('document.querySelector("in-app-editor").shadowRoot.querySelector("[data-page-copy]").shadowRoot.querySelectorAll("[data-iae-layer]").length'), before);
    assert.equal(await run('editor.getChanges().length'), 0);
  });
  await t.test('put colors first and geometry last', async () => {
    await fresh(); await run('editor.select(document.querySelector("#headline"))');
    const order = await run('Array.from(document.querySelector("in-app-editor").shadowRoot.querySelector("[data-fields]").querySelectorAll("[data-text],[data-style],[data-frame]")).map(el=>el.hasAttribute("data-text")?"text":el.dataset.style||el.dataset.frame||el.name)');
    assert.deepEqual(order.slice(0,7), ['color','background-color','border-color','text','border-radius','border-width','font-family']);
    assert.deepEqual(order.slice(-5), ['x','y','scale','width','height']);
  });
  await t.test('preserve the starting view within text raster rounding', async () => {
    await fresh('{persist:false}');
    const before = await send('Page.captureScreenshot', {format:'png',clip:{x:0,y:0,width:460,height:350,scale:1}});
    await run('editor.open()');
    const after = await send('Page.captureScreenshot', {format:'png',clip:{x:0,y:0,width:460,height:350,scale:1}});
    await mkdir(new URL('../test-results/',import.meta.url),{recursive:true});
    await writeFile(new URL('../test-results/simple-before.png',import.meta.url),Buffer.from(before.data,'base64'));
    await writeFile(new URL('../test-results/simple-after.png',import.meta.url),Buffer.from(after.data,'base64'));
    const pixels = comparePNG(before.data, after.data);
    assert.ok(pixels.ratio < .0015, JSON.stringify(pixels));
  });
  await t.test('preserve flex, grid, clipping, and transformed item bounds', async () => {
    await layout();
    const ids = ['#brand','#layout','#card','#rich-title','#inline-group','#emphasis','#wrapped','#nested-button','#row','#square','#row-label','#crop','#cropped-text','#turned','#turned-text'];
    const before = await run('('+JSON.stringify(ids)+').map(id=>box(document.querySelector(id)))');
    await run('editor.open()');
    const after = await run('('+JSON.stringify(ids)+').map(id=>box(copy(id)))');
    for (let index=0;index<ids.length;index++) for (const key of ['x','y','width','height']) assert.ok(Math.abs(before[index][key]-after[index][key])<.1,ids[index]+' '+key+': '+JSON.stringify({before:before[index],after:after[index]}));
    assert.equal(await run('getComputedStyle(copy("#layout")).display'), 'block');
    assert.equal(await run('getComputedStyle(copy("#row")).display'), 'block');
    assert.equal(await run('getComputedStyle(copy("#crop")).overflow'), 'hidden');
  });
  await t.test('preserve text, backgrounds, and clipping within raster rounding', async () => {
    await layout();
    const before = await send('Page.captureScreenshot', {format:'png',clip:{x:0,y:0,width:560,height:440,scale:1}});
    await run('editor.open()');
    const after = await send('Page.captureScreenshot', {format:'png',clip:{x:0,y:0,width:560,height:440,scale:1}});
    await mkdir(new URL('../test-results/',import.meta.url),{recursive:true});
    await writeFile(new URL('../test-results/layout-before.png',import.meta.url),Buffer.from(before.data,'base64'));
    await writeFile(new URL('../test-results/layout-after.png',import.meta.url),Buffer.from(after.data,'base64'));
    const pixels = comparePNG(before.data, after.data, 4);
    assert.ok(pixels.ratio < .0002, JSON.stringify(pixels));
  });
  await t.test('move and edit direct text as an item', async () => {
    await layout(); await run('editor.open();editor.select(document.querySelector("#brand").childNodes[1]);editor.setText("Text item");editor.moveTo(100,100)');
    const changes = JSON.parse(await run('editor.exportChanges("json")')).changes;
    assert.equal(changes[0].selector, '#brand::text(1)');
    assert.equal(changes[0].text.after, 'Text item');
    assert.equal(changes[0].frame.x, 100); assert.equal(changes[0].frame.y, 100);
    assert.equal(await run('document.querySelector("#brand").textContent'), 'Canvas test');
    await run('editor.undo();editor.undo()');
    assert.equal(await run(`copy('[data-iae-layer="#brand::text(1)"] > div').textContent`), 'Canvas test');
  });
  await t.test('keep child positions when a group changes width', async () => {
    await layout(); await run('editor.open();editor.select(document.querySelector("#row"))');
    const before = await run('box(copy("#row-label"))');
    await run('editor.setStyle("width","400px")');
    assert.deepEqual(await run('box(copy("#row-label"))'), before);
  });
  await t.test('scale only the selected box', async () => {
    await layout(); await run('editor.open();editor.select(document.querySelector("#row"))');
    const before = await run('box(copy("#row"))'), square = await run('box(copy("#square"))');
    await drag(await handle('[data-scale]'), before.width, before.height);
    const after = await run('box(copy("#square"))');
    assert.deepEqual(after, square);
    await run('editor.undo()'); assert.deepEqual(await run('box(copy("#square"))'),square);
    await run('editor.redo()'); assert.deepEqual(await run('box(copy("#square"))'), square);
  });

  await t.test('show one instruction before selection', async () => {
    await fresh();
    assert.equal(await run('document.querySelector("in-app-editor").shadowRoot.querySelector("[data-idle] .hint").innerText.trim()'), 'Click anywhere to edit');
    assert.equal(await run('document.querySelector("in-app-editor").shadowRoot.querySelector("[data-panel]").hidden'), true);
    await run('editor.mount()');
    assert.equal(await run('document.querySelectorAll("in-app-editor").length'), 1);
    await sameSource();
  });
  await t.test('copy the page and keep the position when selected', async () => {
    await fresh();
    const source = await run('box(document.querySelector("#headline"))');
    const before = await run('box(copy("#headline"))');
    assert.deepEqual(before, source);
    await click('#headline');
    assert.deepEqual(await run('box(copy("#headline"))'), source);
    await sameSource();
  });
  await t.test('drag freely without moving other items', async () => {
    await fresh();
    const before = await run('box(copy("#headline"))'), neighbour = await run('box(copy("#copy"))');
    await drag({ x: before.x + 25, y: before.y + 15 }, 130, 170);
    const after = await run('box(copy("#headline"))');
    assert.equal(after.x, before.x + 130); assert.equal(after.y, before.y + 170);
    assert.deepEqual(await run('box(copy("#copy"))'), neighbour);
    assert.equal(await run('editor.getChanges().length'), 1);
    await sameSource();
    await run('editor.undo()'); assert.deepEqual(await run('box(copy("#headline"))'), before);
    await run('editor.redo()'); assert.deepEqual(await run('box(copy("#headline"))'), after);
  });
  await t.test('move a selected card from its handle without changing the mode', async () => {
    await layout(); await run('editor.open();editor.select(document.querySelector("#card"))');
    const source = await run('document.body.innerHTML');
    const before = await run('box(copy("#card"))'), child = await run('box(copy("#square"))');
    const grip = await run('box(document.querySelector("in-app-editor").shadowRoot.querySelector("[data-move-handle]"))');
    assert.ok(grip.y + grip.height < before.y);
    await drag(await handle('[data-move-handle]'), 60, 45);
    const after = await run('box(copy("#card"))');
    assert.equal(after.x, before.x + 60); assert.equal(after.y, before.y + 45);
    assert.deepEqual(await run('box(copy("#square"))'), child);
    assert.equal(await run('document.querySelector("in-app-editor").shadowRoot.querySelector("[data-panel] [data-mode=select]").getAttribute("aria-pressed")'), 'true');
    await run('editor.undo()'); assert.deepEqual(await run('box(copy("#card"))'), before);
    await run('editor.redo()'); assert.deepEqual(await run('box(copy("#card"))'), after);
    await uiClick('[data-mode="pan"]');
    await drag(await handle('[data-move-handle]'), 20, 10);
    assert.equal((await run('box(copy("#card"))')).x, after.x + 20);
    assert.deepEqual(await run('box(copy("#square"))'), child);
    assert.equal(await run('document.querySelector("in-app-editor").shadowRoot.querySelector("[data-panel] [data-mode=pan]").getAttribute("aria-pressed")'), 'true');
    assert.equal(await run('document.body.innerHTML'), source);
  });
  await t.test('move the whole group from its handle at reduced zoom', async () => {
    await layout(); await run('editor.open()'); await click('#square'); await addToSelection('#row-label');
    await context('#square'); await action('group');
    await send('Input.dispatchMouseEvent', {type:'mouseWheel',x:400,y:150,deltaX:0,deltaY:Math.log(2)/.002,modifiers:4});
    await sleep(50);
    const before = await run('["#square","#row-label"].map(id=>box(copy(id)))'), card = await run('box(copy("#card"))');
    await drag(await handle('[data-move-handle]'), 0, 0);
    assert.equal(await run('document.querySelector("in-app-editor").shadowRoot.querySelector("[data-element]").textContent'), '2 items');
    await drag(await handle('[data-move-handle]'), 40, 30);
    const after = await run('["#square","#row-label"].map(id=>box(copy(id)))');
    for (let i = 0; i < before.length; i++) {
      assert.equal(after[i].x, before[i].x + 40); assert.equal(after[i].y, before[i].y + 30);
      assert.equal(after[i].width, before[i].width); assert.equal(after[i].height, before[i].height);
    }
    assert.deepEqual(await run('box(copy("#card"))'), card);
    assert.equal(await run('document.querySelector("in-app-editor").shadowRoot.querySelector("[data-panel] [data-mode=select]").getAttribute("aria-pressed")'), 'true');
    for (const [action, expected] of [['undo', before], ['redo', after]]) {
      await run('editor.' + action + '()');
      const restored = await run('["#square","#row-label"].map(id=>box(copy(id)))');
      for (let i = 0; i < expected.length; i++) for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(restored[i][key] - expected[i][key]) < .02);
    }
    await key('Delete');
    assert.equal(await run('document.querySelector("in-app-editor").shadowRoot.querySelector("[data-selection]").hidden'), true);
  });
  await t.test('scale the item and its text from the corner', async () => {
    await fresh(); await click('#button');
    const before = await run('box(copy("#button"))');
    await drag(await handle('[data-scale]'), before.width, before.height);
    const after = await run('box(copy("#button"))');
    assert.ok(Math.abs(after.width - before.width * 2) < 1);
    assert.ok(Math.abs(after.height - before.height * 2) < 1);
    assert.equal(await run('editor.getChanges()[0].frame.scale'), 2);
    await sameSource();
    await run('editor.undo()'); assert.deepEqual(await run('box(copy("#button"))'), before);
  });
  await t.test('side handles change box size without scaling text', async () => {
    await fresh(); await click('#button');
    const font = await run('getComputedStyle(copy("#button")).fontSize');
    await drag(await handle('[data-resize="e"]'), 80, 0);
    assert.equal(await run('box(copy("#button")).width'), 200);
    assert.equal(await run('box(copy("#button")).height'), 40);
    assert.equal(await run('getComputedStyle(copy("#button")).fontSize'), font);
    await run('editor.undo()'); assert.equal(await run('box(copy("#button")).width'), 120);
    await sameSource();
  });
  await t.test('resize from the left and keep the right edge', async () => {
    await fresh(); await click('#button');
    const before = await run('box(copy("#button"))');
    await drag(await handle('[data-resize="w"]'), -50, 0);
    const after = await run('box(copy("#button"))');
    assert.equal(after.width, before.width + 50); assert.equal(after.x, before.x - 50);
    await sameSource();
  });
  await t.test('change text and font through the controls', async () => {
    await fresh(); await click('#copy');
    await run(`(()=>{const root=document.querySelector('in-app-editor').shadowRoot;const text=root.querySelector('[data-text]');text.value='New text';text.dispatchEvent(new Event('change',{bubbles:true}));const size=root.querySelector('[data-style="font-size"]');size.value='27';size.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    assert.equal(await run('copy("#copy").textContent'), 'New text');
    assert.equal(await run('getComputedStyle(copy("#copy")).fontSize'), '27px');
    await sameSource();
  });
  await t.test('double-click to type in the copy', async () => {
    await fresh(); await click('#headline'); await click('#headline', 2);
    assert.equal(await run('copy("#headline").getAttribute("contenteditable")'), 'plaintext-only');
    await send('Input.insertText', { text: 'Typed text' });
    await click('#copy');
    assert.equal(await run('copy("#headline").textContent'), 'Typed text');
    assert.equal(await run('copy("#headline").hasAttribute("contenteditable")'), false);
    await run('editor.undo()'); assert.equal(await run('copy("#headline").textContent'), 'Hello world');
    await sameSource();
  });
  await t.test('keep child items and treat new words as text', async () => {
    await fresh();
    assert.equal(await run('editor.select(document.querySelector("#mixed"));editor.setText("Remove children")'), false);
    await run('editor.setTextNode(0,"Read ")');
    assert.equal(await run(`copy('[data-iae-layer="#mixed::text(0)"] > div').textContent`), 'Read ');
    assert.equal(await run('copy("#bold").textContent'), 'these words');
    await run('editor.select(document.querySelector("#copy"));editor.setText("<img src=x onerror=alert(1)>")');
    assert.equal(await run('copy("#copy").children.length'), 0);
    await sameSource();
  });
  await t.test('reset and undo restore styles and positions', async () => {
    await fresh(); const before = await run('box(copy("#button"))');
    await run('editor.select(document.querySelector("#button"));editor.setStyle("width","200px");editor.moveTo(70,400);editor.reset()');
    assert.deepEqual(await run('box(copy("#button"))'), before);
    await run('editor.undo()'); assert.equal(await run('box(copy("#button")).width'), 200);
    assert.equal(await run('editor.getChanges()[0].frame.y'), 400);
    await sameSource();
  });
  await t.test('edit a link without following it or running page actions', async () => {
    await fresh(); await click('#button'); await click('#link');
    assert.equal(await run('window.clicks||0'), 0); assert.equal(await run('location.hash'), '');
    await run('editor.close()'); await click('#button', 1, true);
    assert.equal(await run('window.clicks'), 1);
  });
  await t.test('keep the source page live while the copy stays fixed', async () => {
    await fresh();
    await run('editor.select(document.querySelector("#headline"));editor.setText("Copy text");document.querySelector("#headline").textContent="App text"');
    await sleep(120);
    assert.equal(await run('copy("#headline").textContent'), 'Copy text');
    assert.equal(await run('document.querySelector("#headline").textContent'), 'App text');
    await run('editor.close()'); assert.equal(await run('document.querySelector("#headline").textContent'), 'App text');
  });
  await t.test('restore a saved draft only in the copy', async () => {
    await fresh('{persist:true,open:true,storageKey:"test-copy"}');
    await run('editor.reset();editor.select(document.querySelector("#headline"));editor.setText("Saved text");editor.moveTo(100,200);editor.close()');
    await sameSource();
    await fresh('{persist:true,open:true,storageKey:"test-copy"}');
    assert.equal(await run('copy("#headline").textContent'), 'Saved text');
    assert.equal(await run('editor.getChanges()[0].frame.x'), 100);
    await sameSource(); await run('editor.reset();localStorage.removeItem("test-copy")');
  });
  await t.test('export the text, styles, page position and scale', async () => {
    await fresh(); await run('editor.select(document.querySelector("#headline"));editor.setText("Title");editor.setStyle("font-size","48px");editor.moveTo(100,200)');
    const data = JSON.parse(await run('editor.exportChanges("json")'));
    assert.equal(data.version, 2); assert.equal(data.changes[0].frame.x, 100); assert.equal(data.changes[0].frame.y, 200);
    assert.equal(data.changes[0].text.before, 'Hello world'); assert.equal(data.changes[0].styles['font-size'], '48px');
    assert.match(await run('editor.exportChanges()'), /separate page copy/); await sameSource();
  });
  await t.test('edit image and link values in the copy', async () => {
    await fresh(); await run('editor.select(document.querySelector("#image"));editor.setAttribute("alt","Image");editor.setAttribute("src","/picture.png")');
    assert.equal(await run('copy("#image").getAttribute("alt")'), 'Image');
    assert.equal(await run('editor.setAttribute("src","javascript:alert(1)")'), false);
    assert.equal(await run('editor.setAttribute("onclick","alert(1)")'), false);
    await run('editor.select(document.querySelector("#link"));editor.setAttribute("href","/page")');
    assert.equal(await run('copy("#link").getAttribute("href")'), '/page'); await sameSource();
  });
  await t.test('move a box without its former children', async () => {
    await fresh(); await run('editor.select(document.querySelector("#inline"));editor.moveTo(100,300);editor.select(document.querySelector("#container"))');
    const parent = await run('box(copy("#container"))'), child = await run('box(copy("#inline"))');
    await run('editor.moveTo('+ (parent.x+40) +','+ (parent.y+60) +')');
    const after = await run('box(copy("#inline"))');
    assert.deepEqual(after, child);
    assert.equal((await run('box(copy("#container"))')).x, parent.x + 40); await sameSource();
  });
  await t.test('reject bad style values and keep repeated items separate', async () => {
    await fresh(); await run('editor.select(document.querySelectorAll(".same")[1]);editor.setText("Second text")');
    assert.equal(await run('copy(".same").textContent'), 'First');
    assert.match(await run('editor.getChanges()[0].selector'), /nth-of-type\(2\)/);
    assert.equal(await run('editor.setStyle("font-size","bad")'), false); await sameSource();
  });
  await t.test('keep each item’s font separate', async () => {
    await fresh(); const font = await run('getComputedStyle(copy("#mixed")).fontFamily');
    await run('editor.select(document.querySelector("#mixed"))');
    assert.equal(await run('getComputedStyle(copy("#mixed")).fontFamily'), font);
    await run('editor.setStyle("font-size","30px");editor.select(document.querySelector("#bold"));editor.setText("Bold text");editor.reset()');
    assert.equal(await run('getComputedStyle(copy("#bold")).fontSize'), '16px');
    await run('editor.undo()');
    assert.equal(await run('getComputedStyle(copy("#bold")).fontSize'), '16px');
    assert.equal(await run('copy("#bold").textContent'), 'Bold text');
    await sameSource();
  });
  await t.test('move outside a clipped parent', async () => {
    await fresh();
    await run('editor.select(document.querySelector("#clipped-title"));editor.moveTo(300,100)');
    const rect = await run('box(copy("#clipped-title"))');
    assert.equal(rect.x, 300); assert.equal(rect.y, 100);
    assert.equal(await run('copy("#clipped-title").closest("#clip")'), null);
    await sameSource();
  });
  await t.test('undo uses the captured copy after the app changes', async () => {
    await fresh(); await run('editor.select(document.querySelector("#headline"));editor.setText("Draft");document.querySelector("#headline").outerHTML="<h1 id=headline>App text</h1>";editor.undo()');
    assert.equal(await run('copy("#headline").textContent'), 'Hello world');
    assert.equal(await run('document.querySelector("#headline").textContent'), 'App text');
    await run('editor.redo()'); assert.equal(await run('copy("#headline").textContent'), 'Draft');
  });
  await t.test('fit the selected controls on a phone', async () => {
    await fresh(); await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await run('editor.select(document.querySelector("#headline"))');
    const rect = await run('box(document.querySelector("in-app-editor").shadowRoot.querySelector("[data-panel]"))');
    assert.ok(rect.x >= 0 && rect.x + rect.width <= 390 && rect.y >= 0 && rect.y + rect.height <= 844);
    await send('Emulation.clearDeviceMetricsOverride');
    await send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 800, deviceScaleFactor: 1, mobile: false });
  });
  await t.test('all items have no other item as a parent', async () => {
    await layout(); await run('editor.open()');
    assert.equal(await run('Array.from(document.querySelector("in-app-editor").shadowRoot.querySelector("[data-page-copy]").shadowRoot.querySelectorAll("[data-iae-layer]")).some(item=>item.parentElement?.closest("[data-iae-layer]"))'), false);
  });
  await t.test('click the title after the card and move only the title', async () => {
    await layout(); await run('editor.open();editor.select(document.querySelector("#card"))');
    const card = await run('box(copy("#card"))'), title = await run('box(copy("#rich-title"))');
    await drag({x:title.x+12,y:title.y+12},80,90);
    assert.deepEqual(await run('box(copy("#card"))'), card);
    const moved = await run('editor.getChanges().filter(change=>change.frame).map(change=>change.selector)');
    assert.deepEqual(moved, ['#rich-title::text(0)']);
  });
  await t.test('a selection rectangle only has to touch an item', async () => {
    await layout(); await run('editor.open()');
    const square = await run('box(copy("#square"))'), card = await run('box(copy("#card"))'), label = await run('box(copy("#row-label"))');
    await drag({x:card.x-8,y:square.y-5},square.x-card.x+9,6);
    assert.equal(await run('document.querySelector("in-app-editor").shadowRoot.querySelector("[data-element]").textContent'), '2 items');
    assert.equal(await run('Boolean(document.querySelector("in-app-editor").shadowRoot.querySelector(\'[data-selected-item="#square"]\'))'), true);
    await drag({x:square.x+16,y:square.y+16},40,50);
    assert.equal((await run('box(copy("#square"))')).x,square.x+40);
    assert.equal((await run('box(copy("#card"))')).x,card.x+40);
    assert.deepEqual(await run('box(copy("#row-label"))'),label);
    await run('editor.undo()'); assert.deepEqual(await run('box(copy("#square"))'),square);
  });
  await t.test('select the whole card, then move and scale all selected items', async () => {
    await layout(); await run('editor.open()');
    const card = await run('box(copy("#card"))'), square = await run('box(copy("#square"))');
    await drag({x:card.x-5,y:card.y-5},card.width+10,card.height+10);
    await drag({x:square.x+16,y:square.y+16},20,30);
    assert.equal((await run('box(copy("#square"))')).x,square.x+20);
    assert.equal((await run('box(copy("#card"))')).y,card.y+30);
    const bounds = await run('box(document.querySelector("in-app-editor").shadowRoot.querySelector("[data-selection]"))');
    await drag(await handle('[data-scale]'),bounds.width,bounds.height);
    assert.ok(Math.abs((await run('box(copy("#square"))')).width-square.width*2)<.1);
    await run('editor.undo();editor.undo()'); assert.deepEqual(await run('box(copy("#square"))'),square);
  });
  await t.test('group, ungroup, and delete with the page menu', async () => {
    await layout(); await run('editor.open()'); await click('#square'); await addToSelection('#row-label');
    const square = await run('box(copy("#square"))'), label = await run('box(copy("#row-label"))');
    await context('#square');
    assert.equal(await run('document.querySelector("in-app-editor").shadowRoot.querySelector("[data-menu]").hidden'),false);
    await action('group'); await run('editor.select(document.querySelector("#square"))');
    assert.equal(await run('document.querySelector("in-app-editor").shadowRoot.querySelector("[data-element]").textContent'),'2 items');
    await drag({x:square.x+16,y:square.y+16},30,30);
    assert.equal((await run('box(copy("#row-label"))')).x,label.x+30);
    await context('#square'); await action('ungroup'); await click('#square');
    const current = await run('box(copy("#square"))');
    await drag({x:current.x+16,y:current.y+16},20,20);
    assert.equal((await run('box(copy("#row-label"))')).x,label.x+30);
    await context('#square'); await action('delete');
    assert.equal(await run('copy("#square").getClientRects().length'),0);
    assert.equal(await run('editor.getChanges().find(item=>item.selector==="#square").deleted'),true);
    await run('editor.undo()'); assert.ok(await run('copy("#square").getClientRects().length'));
    await run('editor.redo()'); assert.equal(await run('copy("#square").getClientRects().length'),0);
    assert.equal(await run('document.querySelector("#square").getClientRects().length'),1);
  });
  await t.test('ignore stored drafts unless storage is enabled', async () => {
    await fresh('{persist:true,storageKey:"old-draft",open:true}');
    await run('editor.select(document.querySelector("#headline"));editor.setText("Old draft")');
    await fresh('{storageKey:"old-draft",open:true}');
    assert.equal(await run('copy("#headline").textContent'),'Hello world');
    await run('editor.select(document.querySelector("#headline"));editor.setText("Current edit");editor.close();editor.open()');
    assert.equal(await run('copy("#headline").textContent'),'Hello world');
    assert.equal(await run('JSON.parse(localStorage.getItem("old-draft")).changes[0].text.after'),'Old draft');
    await run('localStorage.removeItem("old-draft")'); await sameSource();
  });
  await t.test('keep overlapping items in their source order', async () => {
    await layout();
    await run(`(()=>{const stack=document.createElement('div');stack.id='stack';stack.style.cssText='position:absolute;left:350px;top:400px;width:200px;height:120px;background:#999;z-index:1';stack.innerHTML='<div id="inner-stack" style="position:absolute;inset:0;z-index:1"><button id="high" style="position:absolute;left:20px;top:20px;width:100px;height:60px;z-index:99">High</button></div><button id="low" style="position:absolute;left:20px;top:20px;width:100px;height:60px;z-index:2">Low</button>';document.body.append(stack)})()`);
    assert.equal(await run('document.elementFromPoint(400,445).id'),'low');
    await run('editor.open()');
    assert.equal(await run('document.querySelector("in-app-editor").shadowRoot.querySelector("[data-page-copy]").shadowRoot.elementFromPoint(400,445).id'),'low');
    await drag({x:400,y:445},30,0);
    assert.deepEqual(await run('editor.getChanges().filter(change=>change.frame).map(change=>change.selector)'),['#low']);
    await run('editor.undo();editor.select(document.querySelector("#stack"))');
    const before = await run('box(copy("#high"))');
    await key('Delete'); assert.equal(await run('copy("#stack").getClientRects().length'),0);
    assert.deepEqual(await run('box(copy("#high"))'),before);
    assert.ok(await run('copy("#low").getClientRects().length'));
    await run('editor.undo()'); assert.ok(await run('copy("#stack").getClientRects().length'));
  });
  await t.test('zoom at the pointer and move in page coordinates', async () => {
    await fresh(); const before = await run('box(copy("#button"))');
    await send('Input.dispatchMouseEvent',{type:'mouseWheel',x:400,y:150,deltaX:0,deltaY:Math.log(2)/.002,modifiers:4});
    await sleep(50);
    const after = await run('box(copy("#button"))');
    assert.ok(Math.abs(after.width-before.width*.5)<.1);
    assert.ok(Math.abs(after.x-(400+(before.x-400)*.5))<.1);
    assert.equal(await run('document.querySelector("in-app-editor").shadowRoot.querySelector("[data-zoom-value]").textContent'),'50%');
    await drag({x:after.x+after.width/2,y:after.y+after.height/2},40,30);
    const frame = await run('editor.getChanges().find(item=>item.selector==="#button").frame');
    assert.ok(Math.abs(frame.x-before.x-80)<.1); assert.ok(Math.abs(frame.y-before.y-60)<.1);
    await sameSource();
  });
  await t.test('keep positioned controls above direct text', async () => {
    await layout();
    await run(`(()=>{const card=document.createElement('div');card.id='text-stack';card.style.cssText='position:absolute;left:350px;top:400px;width:200px;height:120px;background:white;z-index:3;font-size:30px;line-height:80px';card.innerHTML='Words here<button id="above-text" style="position:absolute;left:0;top:0;width:180px;height:80px">Button</button>';document.body.append(card)})()`);
    assert.equal(await run('document.elementFromPoint(400,440).id'),'above-text');
    await run('editor.open()');
    assert.equal(await run('document.querySelector("in-app-editor").shadowRoot.querySelector("[data-page-copy]").shadowRoot.elementFromPoint(400,440).id'),'above-text');
  });
  await t.test('open at 80 percent with a reset button above the hint', async () => {
    await fresh('{persist:false,open:true,initialZoom:undefined}');
    const source = await run('box(document.querySelector("#headline"))'), item = await run('box(copy("#headline"))');
    assert.ok(Math.abs(item.width-source.width*.8)<.1);
    assert.equal(await run('document.querySelector("in-app-editor").shadowRoot.querySelector("[data-zoom-value]").textContent'),'80%');
    const reset = await handle('[data-idle] [data-action="reset"]'), hint = await handle('[data-idle] .hint');
    assert.ok(reset.y<hint.y);
    assert.ok((await run('box(document.querySelector("in-app-editor").shadowRoot.querySelector("[data-stage]"))')).x>0);
    await sameSource();
  });
  await t.test('show color pickers and keep pasted colors and opacity in sync', async () => {
    await fresh(); await click('#button');
    assert.equal(await run('document.querySelector("in-app-editor").shadowRoot.querySelectorAll("input[type=color]").length'),3);
    await uiValue('[data-color="background-color"]','#e34b23','input');
    await uiValue('[data-color="background-color"]','#e34b23');
    assert.equal(await run('getComputedStyle(copy("#button")).backgroundColor'),'rgb(227, 75, 35)');
    assert.equal(await run('document.querySelector("in-app-editor").shadowRoot.querySelector("[data-style=background-color]").value'),'#E34B23');
    await uiValue('[data-alpha="background-color"]',50,'input');
    await uiValue('[data-alpha="background-color"]',50);
    assert.equal(await run('getComputedStyle(copy("#button")).backgroundColor'),'rgba(227, 75, 35, 0.5)');
    await uiValue('[data-style="color"]','#22cc88');
    assert.equal(await run('document.querySelector("in-app-editor").shadowRoot.querySelector("[data-color=color]").value'),'#22cc88');
    assert.equal(await run('getComputedStyle(copy("#button")).color'),'rgb(34, 204, 136)');
    await sameSource();
  });
  await t.test('use sliders, steppers, and lists with one undo for a slider drag', async () => {
    await fresh(); await click('#headline');
    const original = await run('getComputedStyle(copy("#headline")).fontSize');
    await uiValue('[data-range-style="font-size"]',40,'input');
    await uiValue('[data-range-style="font-size"]',50,'input');
    await uiValue('[data-range-style="font-size"]',60,'input');
    await uiValue('[data-range-style="font-size"]',60);
    assert.equal(await run('getComputedStyle(copy("#headline")).fontSize'),'60px');
    await run('editor.undo()'); assert.equal(await run('getComputedStyle(copy("#headline")).fontSize'),original);
    await uiClick('[data-number="font-size"] [data-step="1"]');
    assert.equal(await run('getComputedStyle(copy("#headline")).fontSize'),parseFloat(original)+1+'px');
    await uiValue('[data-style="font-weight"]','700'); await uiValue('[data-style="font-family"]','Georgia, serif');
    assert.equal(await run('getComputedStyle(copy("#headline")).fontWeight'),'700');
    assert.match(await run('getComputedStyle(copy("#headline")).fontFamily'),/Georgia/);
    await uiClick('[data-choice-style="border-style"][data-value="solid"]');
    assert.equal(await run('getComputedStyle(copy("#headline")).borderTopWidth'),'1px');
    await uiValue('[data-range-style="border-width"]',4);
    assert.equal(await run('getComputedStyle(copy("#headline")).borderTopWidth'),'4px');
    const order = await run('Array.from(document.querySelector("in-app-editor").shadowRoot.querySelectorAll("[data-section]")).map(el=>el.dataset.section)');
    assert.deepEqual(order.slice(0,4),['color','text','border','font']);
    await sameSource();
  });
  await t.test('require both reset steps and let either step be cancelled', async () => {
    await fresh(); await run('editor.select(document.querySelector("#headline"));editor.setText("Edited")');
    await uiClick('[data-panel] [data-action="reset"]');
    assert.equal(await run('document.querySelector("in-app-editor").shadowRoot.querySelector("[data-reset-title]").textContent'),'Reset edits?');
    await uiClick('[data-reset-cancel]'); assert.equal(await run('copy("#headline").textContent'),'Edited');
    await uiClick('[data-panel] [data-action="reset"]'); await uiClick('[data-reset-next]');
    assert.equal(await run('copy("#headline").textContent'),'Edited');
    assert.equal(await run('document.querySelector("in-app-editor").shadowRoot.querySelector("[data-reset-title]").textContent'),'Reset to the current page?');
    await uiClick('[data-reset-cancel]'); assert.equal(await run('copy("#headline").textContent'),'Edited');
    await uiClick('[data-panel] [data-action="reset"]'); await uiClick('[data-reset-next]'); await uiClick('[data-reset-next]');
    assert.equal(await run('copy("#headline").textContent'),'Hello world');
    assert.equal(await run('editor.getChanges().length'),0);
    assert.equal(await run('document.querySelector("in-app-editor").shadowRoot.querySelector("[data-panel]").hidden'),true);
    await uiClick('[data-idle] [data-action="reset"]'); await key('Escape');
    assert.equal(await run('document.querySelector("in-app-editor").shadowRoot.querySelector("[data-reset-dialog]").hidden'),true);
    assert.equal(await run('document.querySelector("in-app-editor").shadowRoot.querySelector("[data-workspace]").hidden'),false);
    await sameSource();
  });
  await t.test('reset captures the current page, including app changes', async () => {
    await fresh(); await run('editor.select(document.querySelector("#headline"));editor.setText("Edited");document.querySelector("#headline").textContent="App update"');
    await uiClick('[data-panel] [data-action="reset"]'); await uiClick('[data-reset-next]'); await uiClick('[data-reset-next]');
    assert.equal(await run('copy("#headline").textContent'),'App update');
    assert.equal(await run('document.querySelector("#headline").textContent'),'App update');
  });
  await t.test('skip a card that surrounds the selection box in either drag direction', async () => {
    await layout(); await run('editor.open();editor.select(document.querySelector("#card"))');
    const card = await run('box(copy("#card"))'), title = await run('box(copy("#rich-title"))');
    await uiClick('[data-mode="select"]');
    const x = card.x+card.width*.6, top = title.y-8, bottom = card.y+card.height-16;
    await drag({x,y:top},-12,bottom-top);
    const selected = await run('Array.from(document.querySelector("in-app-editor").shadowRoot.querySelectorAll("[data-selected-item]")).map(el=>el.dataset.selectedItem)');
    assert.ok(selected.length>0); assert.ok(!selected.includes('#card'));
    assert.deepEqual(await run('box(copy("#card"))'),card);
    await drag({x:x-12,y:bottom},12,top-bottom);
    assert.ok(!await run('Boolean(document.querySelector("in-app-editor").shadowRoot.querySelector(\'[data-selected-item="#card"]\'))'));
    await drag({x:card.x+5,y:top},-12,bottom-top);
    assert.equal(await run('document.querySelector("in-app-editor").shadowRoot.querySelector("[data-element]").textContent'),'article');
    assert.deepEqual(await run('box(copy("#card"))'),card);
  });
  await t.test('switch between select, move, and pan from the top row', async () => {
    await layout(); await run('editor.open();editor.select(document.querySelector("#card"))');
    const card = await run('box(copy("#card"))'), square = await run('box(copy("#square"))');
    await uiClick('[data-mode="move"]');
    await drag({x:card.x+5,y:card.y+45},30,40);
    assert.equal((await run('box(copy("#card"))')).x,card.x+30);
    assert.deepEqual(await run('box(copy("#square"))'),square);
    await uiClick('[data-mode="pan"]'); const before = await run('box(copy("#square"))');
    const changes = await run('editor.getChanges().length');
    await drag({x:card.x+5,y:card.y+45},20,25);
    assert.equal((await run('box(copy("#square"))')).x,before.x+20);
    assert.equal(await run('editor.getChanges().length'),changes);
    await uiClick('[data-mode="select"]');
    assert.equal(await run('document.querySelector("in-app-editor").shadowRoot.querySelector("button[data-mode=select]").getAttribute("aria-pressed")'),'true');
  });
  await t.test('choose modes from the page menu', async () => {
    await fresh();
    for (const mode of ['move','pan','select']) {
      await context('#button');
      await uiClick('[data-menu] button[data-mode="'+mode+'"]');
      assert.equal(await run('document.querySelector("in-app-editor").shadowRoot.querySelector("[data-menu]").hidden'),true);
      assert.equal(await run('document.querySelector("in-app-editor").shadowRoot.querySelector(\'[data-panel] button[data-mode="'+mode+'"]\').getAttribute("aria-pressed")'),'true');
    }
    await sameSource();
  });
  await t.test('add all eight item types from the left sidebar', async () => {
    await fresh(); await uiClick('[data-add-toggle]');
    assert.equal(await run('document.querySelector("in-app-editor").shadowRoot.querySelector("[data-add-panel]").hidden'),false);
    const panel = await run('box(document.querySelector("in-app-editor").shadowRoot.querySelector("[data-add-panel]"))');
    assert.equal(panel.x,20);
    assert.equal(await run('document.querySelector("in-app-editor").shadowRoot.querySelectorAll("[data-add-catalog] [data-add] svg").length'),8);
    for (const type of ['text','button','box','rectangle','arrow','textbox','divider']) await uiClick('[data-add="'+type+'"]');
    await uiClick('[data-add="icon"]'); await uiValue('[data-icon-search]','heart outline','input');
    await uiClick('[data-add-icon="heart-outline"]'); await run('document.fonts.ready');
    const changes = await run('editor.getChanges()');
    assert.deepEqual(changes.map(item=>item.added.type),['text','button','box','rectangle','arrow','textbox','divider','icon']);
    assert.equal(changes.at(-1).added.icon,'heart-outline');
    assert.equal(await run('document.querySelector("in-app-editor").shadowRoot.querySelectorAll("[data-text],[data-text-node]").length'),0);
    assert.equal(await run('document.fonts.check("26px InAppEditorIcons")'),true);
    assert.equal(await run('document.querySelector("in-app-editor").shadowRoot.querySelector("[data-page-copy]").shadowRoot.querySelectorAll("[data-edit-id]").length'),8);
    assert.equal(await run('editor.addItem("constructor")'),false);
    assert.equal(await run('editor.addItem("icon",{icon:"constructor"})'),false);
    await sameSource();
  });
  await t.test('new items support text, style, move, undo, redo, and delete', async () => {
    await fresh(); await run('window.newItem=editor.addItem("button");window.newKey=editor.getChanges()[0].selector;editor.setText("New button");editor.setStyle("background-color","#22cc88");editor.moveTo(120,180)');
    let change = (await run('editor.getChanges()'))[0];
    assert.equal(change.text.after,'New button'); assert.equal(change.frame.x,120);
    assert.match(change.added.html,/New button/); assert.ok(!change.added.html.includes('data-iae-node'));
    await run('editor.undo();editor.undo();editor.undo()');
    assert.equal(await run('copy(newKey).textContent'),'Button');
    await run('editor.undo()'); assert.equal(await run('Boolean(copy(newKey))'),false);
    await run('editor.redo();editor.redo();editor.redo();editor.redo()');
    assert.equal(await run('copy(newKey).textContent'),'New button');
    assert.equal((await run('box(copy(newKey))')).x,120);
    await run('editor.select(copy(newKey))'); await key('Delete');
    assert.equal(await run('editor.getChanges().length'),0);
    await run('editor.undo()'); assert.equal(await run('copy(newKey).textContent'),'New button');
    await run('editor.reset()'); assert.equal(await run('Boolean(copy(newKey))'),false);
    await sameSource();
  });
  await t.test('restore new items and icon choices from a saved draft', async () => {
    await fresh('{persist:true,open:true,storageKey:"added-draft"}');
    await run('editor.reset();editor.addItem("icon",{icon:"star-outline"});editor.moveTo(140,220);editor.addItem("text");editor.setText("Saved item")');
    const keys = await run('editor.getChanges().map(item=>item.selector)');
    await fresh('{persist:true,open:true,storageKey:"added-draft"}'); await run('document.fonts.ready');
    assert.equal(await run('copy('+JSON.stringify(keys[1])+').textContent'),'Saved item');
    assert.equal((await run('box(copy('+JSON.stringify(keys[0])+'))')).x,140);
    assert.equal((await run('editor.getChanges()'))[0].added.icon,'star-outline');
    await run('editor.select(copy('+JSON.stringify(keys[0])+'))'); await uiClick('[data-action="change-icon"]');
    await uiValue('[data-icon-search]','heart outline','input'); await uiClick('[data-add-icon="heart-outline"]');
    assert.equal((await run('editor.getChanges()'))[0].added.icon,'heart-outline');
    await run('editor.undo()'); assert.equal((await run('editor.getChanges()'))[0].added.icon,'star-outline');
    await run('editor.reset();localStorage.removeItem("added-draft")'); await sameSource();
  });
  await t.test('fit a title box without moving its text or its neighbour', async () => {
    await fresh(); await click('#headline');
    const before = await run('box(copy("#headline"))'), neighbour = await run('box(copy("#copy"))');
    const ink = await run('(()=>{const range=document.createRange();range.selectNodeContents(copy("#headline"));return box({getBoundingClientRect:()=>range.getBoundingClientRect()})})()');
    await context('#headline'); await action('fit'); await run('new Promise(requestAnimationFrame)');
    const after = await run('box(copy("#headline"))');
    const fittedInk = await run('(()=>{const range=document.createRange();range.selectNodeContents(copy("#headline"));return box({getBoundingClientRect:()=>range.getBoundingClientRect()})})()');
    assert.ok(after.width<before.width/2); assert.ok(Math.abs(ink.x-fittedInk.x)<.1); assert.ok(Math.abs(ink.y-fittedInk.y)<.1);
    assert.deepEqual(await run('box(copy("#copy"))'),neighbour);
    await run('editor.undo()'); assert.deepEqual(await run('box(copy("#headline"))'),before); await sameSource();
  });
  await t.test('fit a scaled button and keep its label in place', async () => {
    await fresh(); await run('editor.addItem("button");editor.setStyle("width","300px");editor.setStyle("height","100px")');
    await uiValue('[data-frame="scale"]','1.5');
    const key = (await run('editor.getChanges()'))[0].selector;
    await run('window.fitButton=()=>{const range=document.createRange();range.selectNodeContents(copy('+JSON.stringify(key)+'));return box({getBoundingClientRect:()=>range.getBoundingClientRect()})}');
    const before = await run('fitButton()'), size = await run('box(copy('+JSON.stringify(key)+'))');
    await run('editor.fitToContent()');
    const after = await run('fitButton()');
    assert.ok((await run('box(copy('+JSON.stringify(key)+'))')).width<size.width/2);
    for (const coordinate of ['x','y','width','height']) assert.ok(Math.abs(before[coordinate]-after[coordinate])<.1,coordinate);
    await sameSource();
  });
  await t.test('fit wrapped text without changing its lines', async () => {
    await layout(); await run('editor.open();editor.select(document.querySelector("#wrapped"));window.lines=()=>{const range=document.createRange();range.selectNodeContents(copy("#wrapped"));return Array.from(range.getClientRects()).map(r=>({x:r.x,y:r.y,width:r.width,height:r.height}))}');
    const before = await run('lines()'), button = await run('box(copy("#nested-button"))');
    await run('editor.fitToContent()'); const after = await run('lines()');
    assert.equal(after.length,before.length);
    for (let i=0;i<before.length;i++) for (const coordinate of ['x','y','width','height']) assert.ok(Math.abs(before[i][coordinate]-after[i][coordinate])<.1,coordinate);
    assert.deepEqual(await run('box(copy("#nested-button"))'),button);
  });
  await t.test('keep the two sidebars apart and use a direction icon for the controls', async () => {
    await fresh(); await click('#button');
    const first = await run('document.querySelector("in-app-editor").shadowRoot.querySelector("[data-action=move]").innerHTML');
    await uiClick('[data-action="move"]');
    assert.equal(await run('document.querySelector("in-app-editor").shadowRoot.querySelector("[data-action=move]").getAttribute("aria-label")'),'Move controls right');
    assert.notEqual(await run('document.querySelector("in-app-editor").shadowRoot.querySelector("[data-action=move]").innerHTML'),first);
    await uiClick('[data-add-toggle]');
    assert.equal(await run('document.querySelector("in-app-editor").shadowRoot.querySelector("[data-panel]").classList.contains("left")'),false);
    const add = await run('box(document.querySelector("in-app-editor").shadowRoot.querySelector("[data-add-panel]"))'), controls = await run('box(document.querySelector("in-app-editor").shadowRoot.querySelector("[data-panel]"))');
    assert.ok(add.x+add.width<controls.x);
    await sameSource();
  });
  await t.test('remove the copy and leave source handlers intact', async () => {
    await fresh(); await run('editor.select(document.querySelector("#headline"));editor.setText("Copy");editor.destroy()');
    assert.equal(await run('document.querySelectorAll("in-app-editor").length'), 0); await sameSource();
    await click('#button', 1, true); assert.equal(await run('window.clicks'), 1);
  });
});
