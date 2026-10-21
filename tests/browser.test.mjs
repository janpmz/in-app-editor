import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createServer } from '../server.mjs';

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
    await run('window.editor=InAppEditor;editor.mount(' + options + ')');
  }
  async function click(selector, count = 1) {
    const point = await run(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: count });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: count });
  }

  await t.test('mount once and keep the controls apart from page styles', async () => {
    await fresh();
    assert.equal(await run('editor.mount();document.querySelectorAll("in-app-editor").length'), 1);
    assert.equal(await run('document.querySelector("in-app-editor").shadowRoot.querySelector("[data-panel]").hidden'), false);
    assert.equal(await run('getComputedStyle(document.querySelector("#headline")).fontSize'), '32px');
  });
  await t.test('pick links and buttons without running their actions', async () => {
    await fresh();
    await click('#button');
    assert.equal(await run('window.clicks||0'), 0);
    assert.equal(await run('document.querySelector("in-app-editor").shadowRoot.querySelector("[data-element]").textContent'), 'button#button');
    await click('#link');
    assert.equal(await run('location.hash'), '');
    await run('editor.close()');
    await click('#button');
    assert.equal(await run('window.clicks'), 1);
  });
  await t.test('change text and size through the fields', async () => {
    await fresh();
    await click('#copy');
    await run(`(()=>{const root=document.querySelector('in-app-editor').shadowRoot;const text=root.querySelector('[data-text]');text.value='New words';text.dispatchEvent(new Event('change',{bubbles:true}));const size=root.querySelector('[data-style="font-size"]');size.value='27';size.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    assert.equal(await run('document.querySelector("#copy").textContent'), 'New words');
    assert.equal(await run('getComputedStyle(document.querySelector("#copy")).fontSize'), '27px');
    assert.equal(await run('editor.getChanges().length'), 1);
  });
  await t.test('double-click to type, finish on blur, and undo', async () => {
    await fresh();
    await click('#headline', 2);
    assert.equal(await run('document.querySelector("#headline").getAttribute("contenteditable")'), 'plaintext-only');
    await send('Input.insertText', { text: 'Typed right here' });
    await click('#copy');
    assert.equal(await run('document.querySelector("#headline").textContent'), 'Typed right here');
    assert.equal(await run('document.querySelector("#headline").hasAttribute("contenteditable")'), false);
    await run('editor.undo()');
    assert.equal(await run('document.querySelector("#headline").textContent'), 'Hello world');
  });
  await t.test('keep child elements and treat new words as plain text', async () => {
    await fresh();
    assert.equal(await run('editor.select(document.querySelector("#mixed"));editor.setText("erase children")'), false);
    assert.equal(await run('Boolean(document.querySelector("#bold"))'), true);
    await run('editor.select(document.querySelector("#copy"));editor.setText("<img src=x onerror=alert(1)>")');
    assert.equal(await run('document.querySelector("#copy").children.length'), 0);
    assert.equal(await run('document.querySelector("#copy").textContent'), '<img src=x onerror=alert(1)>');
  });
  await t.test('undo, redo, and reset preserve old inline styles', async () => {
    await fresh();
    await run('editor.select(document.querySelector("#button"));editor.setStyle("width","200px");editor.setStyle("height","60px");editor.undo()');
    assert.equal(await run('document.querySelector("#button").style.height'), '40px');
    await run('editor.redo()');
    assert.equal(await run('document.querySelector("#button").style.height'), '60px');
    await run('editor.reset()');
    assert.equal(await run('document.querySelector("#button").style.width'), '120px');
    assert.equal(await run('editor.getChanges().length'), 0);
    await run('editor.undo()');
    assert.equal(await run('document.querySelector("#button").style.width'), '200px');
  });
  await t.test('edit words around a child item without removing it', async () => {
    await fresh();
    await click('#mixed');
    await run(`(()=>{const input=document.querySelector('in-app-editor').shadowRoot.querySelector('[data-text-node="0"]');input.value='Read ';input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    assert.equal(await run('document.querySelector("#mixed").textContent'), 'Read these words intact.');
    assert.equal(await run('document.querySelector("#bold").textContent'), 'these words');
    assert.equal(await run('editor.getChanges()[0].textNodes[0].before'), 'Keep ');
    await run('editor.undo()');
    assert.equal(await run('document.querySelector("#mixed").textContent'), 'Keep these words intact.');
  });
  await t.test('replay overlapping styles in order and restore the old style', async () => {
    await fresh();
    await run('editor.select(document.querySelector("#container"));editor.setStyle("padding","30px");editor.setStyle("padding-top","40px");editor.setStyle("padding","50px");window.overlapWrites=0;window.overlapWatch=new MutationObserver(e=>{window.overlapWrites+=e.length});window.overlapWatch.observe(document.querySelector("#container"),{attributes:true})');
    await sleep(300);
    assert.equal(await run('getComputedStyle(document.querySelector("#container")).paddingTop'), '50px');
    assert.ok(await run('overlapWrites<3'));
    await run('overlapWatch.disconnect();editor.undo()');
    assert.equal(await run('getComputedStyle(document.querySelector("#container")).paddingTop'), '40px');
    await run('editor.reset()');
    assert.equal(await run('document.querySelector("#container").getAttribute("style")'), 'padding:20px');
  });
  await t.test('drag a handle to resize and undo it in one step', async () => {
    await fresh();
    await click('#button');
    const point = await run(`(()=>{const r=document.querySelector('in-app-editor').shadowRoot.querySelector('[data-resize="se"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x + 80, y: point.y + 30, button: 'left', buttons: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x + 80, y: point.y + 30, button: 'left', clickCount: 1 });
    assert.equal(await run('document.querySelector("#button").style.width'), '200px');
    assert.equal(await run('document.querySelector("#button").style.height'), '70px');
    await run('editor.undo()');
    assert.equal(await run('document.querySelector("#button").style.width'), '120px');
    assert.equal(await run('document.querySelector("#button").style.height'), '40px');
  });
  await t.test('size inline text and reject bad style values', async () => {
    await fresh();
    await run('editor.select(document.querySelector("#inline"));editor.setStyle("width","200px")');
    assert.equal(await run('getComputedStyle(document.querySelector("#inline")).display'), 'inline-block');
    assert.equal(await run('editor.setStyle("font-size","bananas")'), false);
    await run('editor.undo()');
    assert.equal(await run('getComputedStyle(document.querySelector("#inline")).display'), 'inline');
  });
  await t.test('save changes and restore them after a reload', async () => {
    await fresh('{open:true,storageKey:"test-draft"}');
    await run('editor.reset();editor.select(document.querySelector("#headline"));editor.setText("Stored words");editor.setStyle("color","#123456")');
    await fresh('{open:true,storageKey:"test-draft"}');
    assert.equal(await run('document.querySelector("#headline").textContent'), 'Stored words');
    assert.equal(await run('getComputedStyle(document.querySelector("#headline")).color'), 'rgb(18, 52, 86)');
    await run('editor.reset();localStorage.removeItem("test-draft")');
  });
  await t.test('keep changes if an app replaces an item, without a style loop', async () => {
    await fresh();
    await run('editor.select(document.querySelector("#headline"));editor.setText("Stay here");editor.setStyle("color","#123456");document.querySelector("#headline").outerHTML="<h1 id=headline>App redraw</h1>";window.styleWrites=0;window.watch=new MutationObserver(e=>{window.styleWrites+=e.length});window.watch.observe(document.querySelector("#headline"),{attributes:true})');
    await sleep(350);
    assert.equal(await run('document.querySelector("#headline").textContent'), 'Stay here');
    assert.equal(await run('getComputedStyle(document.querySelector("#headline")).color'), 'rgb(18, 52, 86)');
    assert.ok(await run('window.styleWrites < 4'));
    await run('watch.disconnect()');
  });
  await t.test('export a useful prompt, JSON and CSS', async () => {
    await fresh();
    await run('editor.select(document.querySelector("#headline"));editor.setText("New headline");editor.setStyle("font-size","64px")');
    const exported = JSON.parse(await run('editor.exportChanges("json")'));
    assert.equal(exported.changes[0].text.before, 'Hello world');
    assert.equal(exported.changes[0].text.after, 'New headline');
    assert.equal(exported.changes[0].styles['font-size'], '64px');
    assert.match(await run('editor.exportChanges()'), /Apply these edits to the website source files/);
    assert.match(await run('editor.exportChanges("css")'), /font-size: 64px !important/);
  });
  await t.test('edit images and links, and reject script addresses', async () => {
    await fresh();
    await run('editor.select(document.querySelector("#image"));editor.setAttribute("alt","A new description");editor.setAttribute("src","/picture.png")');
    assert.equal(await run('document.querySelector("#image").getAttribute("alt")'), 'A new description');
    assert.equal(await run('editor.setAttribute("src","javascript:alert(1)")'), false);
    assert.equal(await run('editor.setAttribute("onclick","alert(1)")'), false);
    await run('editor.select(document.querySelector("#link"));editor.setAttribute("href","/new-page")');
    assert.equal(await run('document.querySelector("#link").getAttribute("href")'), '/new-page');
  });
  await t.test('pick the correct item when there is no ID', async () => {
    await fresh();
    await run('editor.select(document.querySelectorAll(".same")[1]);editor.setText("Only the second")');
    assert.equal(await run('document.querySelectorAll(".same")[0].textContent'), 'First');
    assert.match(await run('editor.getChanges()[0].selector'), /nth-of-type\(2\)/);
  });
  await t.test('block forms only in edit mode and remove handlers on destroy', async () => {
    await fresh();
    await run('document.querySelector("#form").requestSubmit()');
    assert.equal(await run('window.submits||0'), 0);
    await run('editor.close();document.querySelector("#form").requestSubmit()');
    assert.equal(await run('window.submits'), 1);
    await run('editor.open();editor.select(document.querySelector("#headline"));editor.setText("Draft");editor.destroy({revert:true})');
    assert.equal(await run('document.querySelectorAll("in-app-editor").length'), 0);
    assert.equal(await run('document.querySelector("#headline").textContent'), 'Hello world');
    await click('#button');
    assert.equal(await run('window.clicks'), 1);
  });
  await t.test('fit the controls on a phone', async () => {
    await fresh();
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    const box = await run(`(()=>{const r=document.querySelector('in-app-editor').shadowRoot.querySelector('[data-panel]').getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}})()`);
    assert.ok(box.left >= 0 && box.right <= 390 && box.top >= 0 && box.bottom <= 844);
    await send('Emulation.clearDeviceMetricsOverride');
  });
});
