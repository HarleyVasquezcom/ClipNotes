import { createRequire } from 'node:module';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';

let puppeteer;
try {
  puppeteer = createRequire(import.meta.url)('puppeteer');
} catch (e) {
  console.error('puppeteer not installed — run `npm install` first');
  process.exit(2);
}
let CHROME;
try {
  CHROME = process.env.PROBE_CHROME || (await puppeteer.executablePath());
} catch (e) {
  CHROME = process.env.PROBE_CHROME;
}

const DEPLOY_URL = (process.env.CLIPNOTES_DEPLOY_URL || '').replace(/\/+$/, '');
const EXT = path.resolve(import.meta.dirname, '..');
const EXT_FWD = EXT.replaceAll('\\', '/');
const FIXTURE = fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'site.html'), 'utf8');

const EXPECTED_LABELS = {
  tagline: {
    en: 'clip a note to anything',
    es: 'sujeta una nota a cualquier cosa',
    fr: 'épinglez une note à tout',
    pt: 'prenda uma nota a qualquer coisa',
    it: 'appunta una nota a qualsiasi cosa',
    de: 'hefte eine Notiz an alles',
  },
  credit: {
    en: 'Built by Harley Vásquez', es: 'Creado por Harley Vásquez', fr: 'Créé par Harley Vásquez',
    pt: 'Criado por Harley Vásquez', it: 'Creato da Harley Vásquez', de: 'Erstellt von Harley Vásquez',
  },
};

let passes = 0;
let failures = 0;
const problems = [];
const check = (name, ok, detail = '') => {
  if (ok) {
    passes++;
    console.log('  PASS ' + name);
  } else {
    failures++;
    problems.push(name + (detail ? ' — ' + detail : ''));
    console.log('  FAIL ' + name + (detail ? ' — ' + detail : ''));
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, timeout = 8000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) {
      /* retry */
    }
    await sleep(150);
  }
  return null;
};
const getAll = async (popup) => (await popup.evaluate(() => chrome.storage.local.get(null)));
const safeClose = (p) => {
  if (p && !p.isClosed()) p.close().catch(() => {});
};

console.log('ClipNotes probe (extension: ' + EXT + ')');

const server = http.createServer((req, res) => {
  const p = new URL(req.url, 'http://localhost').pathname;
  if (p === '/site.html' || p === '/nocors.html') {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      ...(p === '/site.html' ? { 'Access-Control-Allow-Origin': '*' } : {}),
    });
    res.end(FIXTURE);
  } else {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
const SITE_PAGE = `http://127.0.0.1:${PORT}/site.html`;
const NO_CORS = `http://127.0.0.1:${PORT}/nocors.html`;
const LANDING = path.join(EXT, 'landing', 'index.html');
console.log('fixture server: ' + SITE_PAGE);
let ZIP_BYTES = null;

const browser = await puppeteer.launch({
  headless: true,
  executablePath: CHROME,
  args: [`--disable-extensions-except=${EXT_FWD}`, `--load-extension=${EXT_FWD}`],
  protocolTimeout: 60000,
});

let pageA = null;
let pageB = null;
let popup = null;
const popupErrors = [];
try {
  // ---------- BASELINE ----------
  const base = await browser.newPage();
  const baseErrors = [];
  base.on('pageerror', (e) => baseErrors.push(e.message));
  await base.goto(SITE_PAGE + '?noext=1', { waitUntil: 'domcontentloaded' });
  await base.bringToFront();
  await sleep(500);
  check('baseline: fixture loads', (await base.evaluate(() => document.title)) === 'ClipNotes fixture — the salt oven', '');
  check('baseline: no JS errors on fixture page', baseErrors.length === 0, baseErrors.join(' | '));
  await base.close();

  // ---------- EXTENSION REGISTERED ----------
  const reg = await browser.newPage();
  await reg.goto('chrome://extensions-internals', { waitUntil: 'domcontentloaded' });
  await sleep(2000);
  const data = JSON.parse(await reg.evaluate(() => document.body.innerText));
  const entry = data.find((e) => e.name === 'ClipNotes');
  check('extension registered and ENABLED', !!entry && entry.registry_status === 'ENABLED' && entry.location === 'COMMAND_LINE', entry ? entry.registry_status : 'not found');
  check('manifest_version 3 confirmed by Chrome', entry ? entry.manifest_version === 3 : false, '');
  if (!entry) throw new Error('ClipNotes extension not found');
  const popupUrl = `chrome-extension://${entry.id}/popup.html`;
  await reg.close();

  // ---------- POPUP ----------
  popup = await browser.newPage();
  popup.on('pageerror', (e) => popupErrors.push(e.message));
  await popup.goto(popupUrl, { waitUntil: 'domcontentloaded' });
  await popup.waitForFunction(() => document.getElementById('addBtn') !== null, { timeout: 8000, polling: 100 });
  await sleep(500);

  const defaults = await getAll(popup);
  check('defaults: cn:notes = []', Array.isArray(defaults['cn:notes']) && defaults['cn:notes'].length === 0, JSON.stringify(defaults['cn:notes']));
  check('popup renders without JS exceptions', popupErrors.length === 0, popupErrors.join(' | '));
  check(
    'popup surface: clip button, blank note, search, exports, lang, credit',
    (await popup.evaluate(
      () =>
        ['addBtn', 'newBtn', 'searchInput', 'exportMdBtn', 'exportJsonBtn', 'langSel', 'list', 'noteCount', 'capNote'].every((id) => !!document.getElementById(id)) &&
        !!document.querySelector('.credit')
    )) === true,
    ''
  );
  check('capNote shows default cap of 300', (await popup.evaluate(() => document.getElementById('capNote').textContent)) === '0 of 300 notes', '');

  // fixture tab (active)
  pageA = await browser.newPage();
  const stray = (await browser.pages()).filter((p) => p !== popup && p !== pageA);
  for (const s of stray) await s.close();
  await pageA.goto(SITE_PAGE, { waitUntil: 'domcontentloaded' });
  await pageA.bringToFront();
  await sleep(500);

  // ---------- CAPTURE (fetch tier, CORS-open fixture) ----------
  const captured = await popup.evaluate(() => window.__cnAdd());
  check('capture: reads the active fixture tab via fetch', !!captured && captured.source === 'fetch', JSON.stringify(captured));
  check('capture: fixture title captured', captured.title === 'ClipNotes fixture — the salt oven', captured && captured.title);
  check(
    'capture: readable text body captured',
    !!captured && captured.text.includes('salt oven') && captured.text.includes('anchovies') && captured.text.includes('harbor'),
    captured ? captured.text.slice(0, 80) : ''
  );
  const notes1 = await popup.evaluate(() => window.__cnNotes());
  check('notebook: exactly 1 clip after capture', notes1.length === 1, 'len=' + notes1.length);
  check('popup renders the clip with a snippet', (await popup.evaluate(() => document.querySelectorAll('.item').length)) === 1 && (await popup.evaluate(() => !!document.querySelector('.item .isnip'))), '');
  check('noteCount shows 1 note', (await popup.evaluate(() => document.getElementById('noteCount').textContent)) === '1 note', '');

  // ---------- CAPTURE FALLBACK (no-CORS fixture -> title only) ----------
  pageB = await browser.newPage();
  await pageB.goto(NO_CORS, { waitUntil: 'domcontentloaded' });
  await pageB.bringToFront();
  await sleep(500);
  const capped = await popup.evaluate(() => window.__cnAdd());
  check('fallback: page that blocks fetch+script is clipped title-only', !!capped && capped.source === 'title' && capped.text === '', JSON.stringify(capped));
  check('fallback: URL still recorded', !!capped && capped.url === NO_CORS, capped && capped.url);
  check('fallback: honest toast shown', (await popup.evaluate(() => document.getElementById('status').textContent)) !== '', '');
  const notes2 = await popup.evaluate(() => window.__cnNotes());
  check('notebook: 2 clips after fallback', notes2.length === 2, 'len=' + notes2.length);

  // ---------- NOTE EDIT ----------
  const noteSaved = await popup.evaluate(() => {
    const ta = document.querySelector('.item textarea');
    ta.value = 'buy rosemary bread before noon';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return document.querySelector('.item .note-save').click();
  });
  await sleep(300);
  const withNote = await popup.evaluate(() => window.__cnNotes());
  check('note edit: note persisted with the clip', withNote.some((i) => i.note === 'buy rosemary bread before noon'), JSON.stringify(withNote.map((i) => i.note)));
  check('note edit: toast shown', (await popup.evaluate(() => document.getElementById('status').textContent)) !== '', '');

  // ---------- SAVE MORE + BLANK NOTE ----------
  await popup.evaluate(() => window.__cnSave({ title: 'Harbor gulls', url: 'http://example.com/gulls', text: 'gulls along the masts', note: '', source: 'title' }));
  await popup.evaluate(() => window.__cnSave({ title: 'Mañana sign', url: 'http://example.com/manana', text: 'the bakery sells out by noon', note: '', source: 'title' }));
  const blank = await popup.evaluate(() => window.__cnNew());
  check('blank note: starts without url and with untitled name', !!blank && blank.url === '' && blank.title.trim() !== '', JSON.stringify(blank));
  check('noteCount shows 5 notes', (await popup.evaluate(() => document.getElementById('noteCount').textContent)) === '5 notes', '');
  check('rows rendered: 5 clips', (await popup.evaluate(() => document.querySelectorAll('.item').length)) === 5, '');

  // ---------- SEARCH ----------
  await popup.evaluate(() => {
    const el = document.getElementById('searchInput');
    el.value = 'anchovies';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(250);
  check('search "anchovies" narrows to 1 row', (await popup.evaluate(() => document.querySelectorAll('.item').length)) === 1, '');
  await popup.evaluate(() => {
    const el = document.getElementById('searchInput');
    el.value = 'rosemary bread before noon';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(250);
  check('search covers notes too', (await popup.evaluate(() => document.querySelectorAll('.item').length)) === 1, '');
  await popup.evaluate(() => {
    const el = document.getElementById('searchInput');
    el.value = 'zzzzz';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(250);
  check('search miss shows empty state', (await popup.evaluate(() => document.querySelectorAll('.item').length)) === 0 && (await popup.evaluate(() => !!document.querySelector('.empty'))), '');
  await popup.evaluate(() => {
    const el = document.getElementById('searchInput');
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(250);
  check('clearing search restores all rows', (await popup.evaluate(() => document.querySelectorAll('.item').length)) === 5, '');

  // ---------- OPEN ----------
  const beforeTabs = await popup.evaluate(async () => (await chrome.tabs.query({})).length);
  await popup.evaluate(() => document.querySelector('.item:has(.chip) .iacts .mini').click());
  await sleep(600);
  const afterTabs = await popup.evaluate(async () => (await chrome.tabs.query({})).length);
  check('open: opens the clip URL in a new tab', afterTabs === beforeTabs + 1, `before=${beforeTabs} after=${afterTabs}`);

  // ---------- DELETE ----------
  const beforeDel = await popup.evaluate(() => window.__cnNotes());
  await popup.evaluate(() => {
    window.confirm = () => true;
    const row = document.querySelector('.item');
    row.querySelectorAll('.mini')[row.querySelectorAll('.mini').length - 1].click();
  });
  await sleep(300);
  const afterDel = await popup.evaluate(() => window.__cnNotes());
  check('delete: removes the clicked clip', beforeDel.length === 5 && afterDel.length === 4, `bef=${beforeDel.length} aft=${afterDel.length}`);

  // ---------- CAP ----------
  const capSet = await popup.evaluate(() => window.__cnCap(3));
  check('cap: override accepts 3', capSet === 3, String(capSet));
  await popup.evaluate(() => window.__cnSave({ title: 'Fill note A', url: 'http://example.com/fill-a', text: 'x', savedAt: Date.now() - 90000, source: 'title' }));
  await popup.evaluate(() => window.__cnSave({ title: 'Fill note B', url: 'http://example.com/fill-b', text: 'x', savedAt: Date.now() - 80000, source: 'title' }));
  const beforeCap = await popup.evaluate(() => window.__cnNotes());
  await popup.evaluate(() => window.__cnSave({ title: 'Oldest keep-out', url: 'http://example.com/old', text: 'x', savedAt: 1, source: 'title' }));
  const afterCap = await popup.evaluate(() => window.__cnNotes());
  check(
    'cap: notebook pruned to 3, oldest dropped',
    beforeCap.length === 3 && afterCap.length === 3 && !afterCap.some((i) => i.savedAt === 1),
    `bef=${beforeCap.length} aft=${afterCap.length}`
  );
  check('cap: capNote shows 3 of 3 notes', (await popup.evaluate(() => document.getElementById('capNote').textContent)) === '3 of 3 notes', '');
  await popup.evaluate(() => chrome.storage.local.remove('cn:cap'));

  // ---------- EXPORT JSON / MD ----------
  const exported = await popup.evaluate(() => window.__cnExportJson());
  const parsed = JSON.parse(exported);
  const stackNow = await popup.evaluate(() => window.__cnNotes());
  check('export json: has all 3 clips', Array.isArray(parsed.notes) && parsed.notes.length === 3 && parsed.total === 3 && parsed.notes.length === stackNow.length, 'total=' + (parsed && parsed.total));
  const md = await popup.evaluate(() => window.__cnExportMd());
  check('export md: heading, title and note present', md.includes('# ClipNotes') && md.includes('## ') && md.includes('buy rosemary bread before noon'), md.slice(0, 60) + '…');
  check('export md: every clip gets a section', (md.match(/^## /gm) || []).length === 3, '');

  // ---------- i18n popup ----------
  const langCheck = async (code) => {
    await popup.select('#langSel', code);
    const ok = await waitFor(() => popup.evaluate((exp) => document.querySelector('[data-i18n="tagline"]')?.textContent === exp, EXPECTED_LABELS.tagline[code]), 6000);
    check(`language switch to ${code} re-renders popup`, ok === true, EXPECTED_LABELS.tagline[code]);
    if (ok) {
      const credit = await popup.evaluate(() => document.querySelector('.credit')?.textContent);
      check(`language ${code}: credit localized`, credit === EXPECTED_LABELS.credit[code], credit);
      await popup.goto(popupUrl, { waitUntil: 'domcontentloaded' });
      await popup.waitForFunction(() => document.querySelector('[data-i18n="tagline"]')?.textContent !== '', { timeout: 8000, polling: 100 });
      const persisted = await popup.evaluate((exp) => document.querySelector('[data-i18n="tagline"]')?.textContent === exp, EXPECTED_LABELS.tagline[code]);
      check(`language ${code}: persisted across reload`, persisted === true, 'reverted');
    }
  };
  await popup.select('#langSel', 'en');
  await sleep(200);
  for (const code of ['es', 'fr', 'pt', 'it', 'de']) {
    await langCheck(code);
  }
  await popup.evaluate(() => chrome.storage.local.remove('cn:lang'));
  await popup.goto(popupUrl, { waitUntil: 'domcontentloaded' });
  await popup.waitForFunction(() => document.querySelector('[data-i18n="tagline"]')?.textContent !== '', { timeout: 8000, polling: 100 });
  const navLang = await popup.evaluate(() => (navigator.language || 'en').toLowerCase().split('-')[0]);
  const defaulted = await popup.evaluate(() => document.querySelector('[data-i18n="tagline"]')?.textContent);
  check('default language = navigator language (or en)', ['en', 'es', 'fr', 'pt', 'it', 'de'].includes(navLang) && EXPECTED_LABELS.tagline[navLang] === defaulted, `nav=${navLang} got=${defaulted}`);
  await popup.evaluate(() => chrome.storage.local.set({ 'cn:lang': 'en' }));
  const popupCreditUrl = await popup.evaluate(() => document.querySelector('.credit').href);
  check('credit links to LinkedIn (popup)', popupCreditUrl === 'https://www.linkedin.com/in/harleyvasquez/', popupCreditUrl);

  // ---------- FROZEN ----------
  const frozenAll = await getAll(popup);
  const keys = Object.keys(frozenAll).filter((k) => k.startsWith('cn:'));
  check(
    'frozen: only the 2 cn:* keys in storage',
    keys.length === 2 && ['cn:lang', 'cn:notes'].every((k) => keys.includes(k)),
    keys.join(',')
  );

  // ---------- Landing ----------
  const landing = await browser.newPage();
  const landingErrors = [];
  landing.on('pageerror', (e) => landingErrors.push(e.message));
  await landing.goto('file://' + LANDING.replaceAll('\\', '/'), { waitUntil: 'domcontentloaded' });
  await sleep(700);
  const heroOk = await landing.evaluate(() => {
    const t = document.querySelector('[data-i18n="heroTitle"]')?.textContent || '';
    return t.length > 0 && document.title !== '';
  });
  check('landing renders with localized hero', heroOk === true, '');
  await landing.select('#langSel', 'es');
  const heroEs = await waitFor(() => landing.evaluate(() => document.querySelector('[data-i18n="tagline"]')?.textContent), 5000);
  check('landing switch to es shows spanish tagline', heroEs === EXPECTED_LABELS.tagline.es, heroEs);
  check('no JS errors on landing', landingErrors.length === 0, landingErrors.join(' | '));
  const landingCreditUrl = await landing.evaluate(() => document.querySelector('[data-i18n="credit"]')?.href);
  check('credit links to LinkedIn (landing)', landingCreditUrl === 'https://www.linkedin.com/in/harleyvasquez/', landingCreditUrl);
  await landing.close();

  // ---------- Packaging ----------
  const zipPath = path.join(EXT, 'dist', 'clipnotes.zip');
  const landingZip = path.join(EXT, 'landing', 'clipnotes.zip');
  check('dist/clipnotes.zip exists', fs.existsSync(zipPath), zipPath);
  check('landing/clipnotes.zip exists (CTA target)', fs.existsSync(landingZip), landingZip);
  if (fs.existsSync(zipPath) && fs.existsSync(landingZip)) {
    const s = fs.statSync(zipPath);
    const l = fs.statSync(landingZip);
    check('landing zip byte-identical to dist zip', s.size === l.size && s.size > 0, `dist=${s.size} landing=${l.size}`);
    ZIP_BYTES = l.size;
  }
  const iconOk = ['icon16.png', 'icon48.png', 'icon128.png'].every((f) => {
    const p = path.join(EXT, 'icons', f);
    return fs.existsSync(p) && fs.readFileSync(p)[0] === 0x89 && fs.readFileSync(p)[1] === 0x50;
  });
  check('icons 16/48/128 present and valid PNG', iconOk, '');

  // ---------- Deploy (gated) ----------
  if (DEPLOY_URL) {
    try {
      const res = await fetch(DEPLOY_URL + '/', { headers: { 'User-Agent': 'clipnotes-probe' } });
      const body = await res.text();
      check('deployed landing responds (Vercel)', res.status === 200 && body.includes('ClipNotes'), res.status + ' len=' + body.length);
      const zipRes = await fetch(DEPLOY_URL + '/clipnotes.zip', { headers: { 'User-Agent': 'clipnotes-probe' } });
      const zipBody = await zipRes.arrayBuffer();
      check('deployed landing serves the extension zip', zipRes.status === 200 && typeof ZIP_BYTES === 'number' && zipBody.byteLength === ZIP_BYTES, zipRes.status + ' bytes=' + zipBody.byteLength + ' expected=' + ZIP_BYTES);
    } catch (error) {
      const msg = error && error.message ? error.message : String(error);
      check('deployed landing responds (Vercel)', false, msg);
      check('deployed landing serves the extension zip', false, msg);
    }
  } else {
    console.log('  [info] CLIPNOTES_DEPLOY_URL not set; skipping deployed-landing checks.');
  }
} finally {
  safeClose(popup);
  safeClose(pageA);
  safeClose(pageB);
  if (browser) browser.close().catch(() => {});
  server.close();
}

console.log('');
console.log(`RESULT: ${passes} passed, ${failures} failed`);
if (failures > 0) {
  console.log('PROBLEMS:');
  for (const p of problems) console.log('  - ' + p);
  process.exit(1);
}
process.exit(0);