const K = { NOTES: 'cn:notes', CAP: 'cn:cap', LANG: 'cn:lang' };
const CAP_DEFAULT = 300;
const CREDIT_URL = 'https://www.linkedin.com/in/harleyvasquez/';
const LOCALES = { en: 'en-US', es: 'es-ES', fr: 'fr-FR', pt: 'pt-PT', it: 'it-IT', de: 'de-DE' };

let notes = [];
let searchQ = '';

const getLocal = (keys) => chrome.storage.local.get(keys);
const setLocal = (obj) => chrome.storage.local.set(obj);
const byId = (id) => document.getElementById(id);

function L(key, params) {
  return window.__cnT(key, undefined, params);
}

function hostOf(url) {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch (e) {
    return '';
  }
}

let toastTimer = null;
function setStatus(msg) {
  const el = byId('status');
  el.textContent = msg || '';
  clearTimeout(toastTimer);
  if (msg) toastTimer = setTimeout(() => { el.textContent = ''; }, 3500);
}

async function notesKey() {
  const s = await getLocal(null);
  const capRaw = s[K.CAP];
  const cap = typeof capRaw === 'number' && capRaw > 0 ? capRaw : CAP_DEFAULT;
  return { notes: Array.isArray(s[K.NOTES]) ? s[K.NOTES].slice() : [], cap };
}

async function persist(next) {
  notes = next;
  await setLocal({ [K.NOTES]: notes });
}

function pruneIfNeeded(arr, cap) {
  if (arr.length <= cap) return arr;
  const drop = arr.length - cap;
  const sorted = arr.slice().sort((a, b) => a.savedAt - b.savedAt);
  const ids = new Set(sorted.slice(0, drop).map((i) => i.id));
  return arr.filter((i) => !ids.has(i.id));
}

async function saveItem(raw) {
  const { notes: cur, cap } = await notesKey();
  const item = {
    id: 'cn_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
    title: typeof raw.title === 'string' ? raw.title.slice(0, 300) : '',
    url: typeof raw.url === 'string' ? raw.url.slice(0, 2000) : '',
    text: typeof raw.text === 'string' ? raw.text.slice(0, 20000) : '',
    note: typeof raw.note === 'string' ? raw.note.slice(0, 4000) : '',
    savedAt: typeof raw.savedAt === 'number' ? raw.savedAt : Date.now(),
    source: typeof raw.source === 'string' ? raw.source : 'title',
  };
  const next = pruneIfNeeded([item, ...cur], cap);
  await persist(next);
  return item;
}

async function captureActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id || typeof tab.url !== 'string' || !tab.url.startsWith('http')) {
    return null;
  }
  try {
    const res = await fetch(tab.url, { redirect: 'follow' });
    if (res.ok) {
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      doc.title = doc.title || '';
      const root = doc.querySelector('article, main, [role="main"]') || doc.body;
      const text = ((root ? root.textContent : '') || '').replace(/\s+/g, ' ').trim().slice(0, 20000);
      return { title: doc.title || tab.title || '', url: tab.url, text, source: text ? 'fetch' : 'title' };
    }
  } catch (e) {
    /* CORS or network — fall through to scripting */
  }
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const root = document.querySelector('article, main, [role="main"]') || document.body;
        const text = ((root ? root.textContent : '') || '').replace(/\s+/g, ' ').trim().slice(0, 20000);
        return { text, title: document.title || '' };
      },
    });
    const out = results && results[0] && results[0].result;
    if (out) {
      return { title: out.title || tab.title || '', url: tab.url, text: out.text, source: out.text ? 'script' : 'title' };
    }
  } catch (e) {
    /* no activeTab grant */
  }
  return { title: tab.title || tab.url, url: tab.url, text: '', source: 'title' };
}

async function addActiveTab() {
  const captured = await captureActiveTab();
  if (!captured) {
    setStatus(L('noActiveTab'));
    return null;
  }
  if (!captured.text) setStatus(L('couldNotRead'));
  else setStatus(L('added'));
  await saveItem(captured);
  await render();
  return captured;
}

async function newBlankNote() {
  const item = await saveItem({ title: L('untitled'), url: '', text: '', note: '', source: 'blank' });
  setStatus(L('added'));
  await render();
  return item;
}

function dateStr(savedAt) {
  try {
    const code = (window.__cnDict && document.querySelector('#langSel')?.value) || 'en';
    return new Date(savedAt).toLocaleDateString(LOCALES[code] || LOCALES.en, { month: 'short', day: 'numeric' });
  } catch (e) {
    return new Date(savedAt).toLocaleDateString();
  }
}

function matchesSearch(item, q) {
  if (!q) return true;
  const hay = (item.title + ' ' + (item.url || '') + ' ' + (item.text || '') + ' ' + (item.note || '')).toLowerCase();
  return hay.includes(q.toLowerCase());
}

function visible() {
  return notes.filter((i) => matchesSearch(i, searchQ));
}

async function render() {
  const listEl = byId('list');
  const items = visible();
  byId('noteCount').textContent = notes.length === 1 ? L('noteCountOne') : L('noteCount', { n: notes.length });
  const { cap } = await notesKey();
  byId('capNote').textContent = L('capNote', { n: notes.length, m: cap });
  listEl.textContent = '';
  if (!items.length) {
    const div = document.createElement('div');
    div.className = 'empty';
    div.textContent = searchQ ? L('emptySearch') : L('emptyAll');
    listEl.appendChild(div);
    return;
  }
  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'item';
    row.dataset.id = item.id;

    const title = document.createElement('div');
    title.className = 'ititle';
    title.textContent = item.title || item.url;
    const sub = document.createElement('div');
    sub.className = 'isub';
    if (item.url) {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = hostOf(item.url);
      sub.appendChild(chip);
    }
    const when = document.createElement('span');
    when.textContent = L('savedOn') + ' ' + dateStr(item.savedAt);
    sub.appendChild(when);
    row.appendChild(title);
    row.appendChild(sub);
    if (item.text) {
      const snip = document.createElement('div');
      snip.className = 'isnip';
      snip.textContent = item.text.replace(/\s+/g, ' ').slice(0, 120);
      row.appendChild(snip);
    }

    const ned = document.createElement('div');
    ned.className = 'nedit';
    const ta = document.createElement('textarea');
    ta.placeholder = L('notePh');
    ta.value = item.note || '';
    const nrow = document.createElement('div');
    nrow.className = 'nrow';
    const nsave = document.createElement('button');
    nsave.className = 'mini note-save';
    nsave.textContent = L('saveNote');
    nsave.addEventListener('click', async () => {
      await setNote(item.id, ta.value);
      setStatus(L('noteSaved'));
    });
    nrow.appendChild(nsave);
    ned.appendChild(ta);
    ned.appendChild(nrow);
    row.appendChild(ned);

    const acts = document.createElement('div');
    acts.className = 'iacts';
    if (item.url) {
      const openB = document.createElement('button');
      openB.className = 'mini';
      openB.textContent = L('open');
      openB.addEventListener('click', () => openItem(item.id));
      acts.appendChild(openB);
    }
    const del = document.createElement('button');
    del.className = 'mini del';
    del.textContent = L('delete');
    del.addEventListener('click', () => deleteItem(item.id));
    acts.appendChild(del);
    row.appendChild(acts);

    listEl.appendChild(row);
  }
}

async function setNote(id, value) {
  const next = notes.map((i) => (i.id === id ? { ...i, note: value.slice(0, 4000) } : i));
  await persist(next);
}

async function openItem(id) {
  const item = notes.find((i) => i.id === id);
  if (item && item.url) await chrome.tabs.create({ url: item.url, active: false });
}

async function deleteItem(id) {
  if (!window.confirm(L('confirmDelete'))) return;
  const next = notes.filter((i) => i.id !== id);
  await persist(next);
  setStatus(L('deleted'));
  await render();
}

function download(name, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function exportJson() {
  const out = { exportedAt: Date.now(), notes, total: notes.length };
  download('clipnotes-export.json', JSON.stringify(out, null, 2), 'application/json');
  setStatus(L('exportedJson'));
  return JSON.stringify(out);
}

function exportMd() {
  let md = '# ClipNotes — export ' + new Date().toISOString().slice(0, 10) + '\n\n';
  for (const n of notes) {
    md += '## ' + (n.title || n.url || 'Untitled') + '\n\n';
    md += '- clipped: ' + new Date(n.savedAt).toISOString() + '\n';
    if (n.url) md += '- url: ' + n.url + '\n';
    if (n.note) md += '\n> ' + n.note.replace(/\n/g, '\n> ') + '\n';
    if (n.text) md += '\n' + n.text.slice(0, 500) + '\n';
    md += '\n---\n\n';
  }
  download('clipnotes-export.md', md, 'text/markdown');
  setStatus(L('exportedMd'));
  return md;
}

/* ---------- probe hooks ---------- */
window.__cnNotes = async () => (await notesKey()).notes;
window.__cnSave = async (raw) => {
  const item = await saveItem(raw || {});
  await render();
  return item;
};
window.__cnAdd = async () => {
  const captured = await addActiveTab();
  return captured;
};
window.__cnNew = async () => {
  return await newBlankNote();
};
window.__cnSetNote = async (id, value) => {
  await setNote(id, value);
  await render();
  return (await notesKey()).notes.find((i) => i.id === id);
};
window.__cnExportJson = async () => exportJson();
window.__cnExportMd = async () => exportMd();
window.__cnNowMs = () => Date.now();
window.__cnCap = async (v) => {
  const s = await getLocal(K.CAP);
  const cap = typeof s[K.CAP] === 'number' ? s[K.CAP] : CAP_DEFAULT;
  if (typeof v === 'number') {
    await setLocal({ [K.CAP]: v });
    return v;
  }
  return cap;
};
/* ---------- ---------- */

async function init() {
  const s = await getLocal(null);
  notes = Array.isArray(s[K.NOTES]) ? s[K.NOTES] : [];
  if (!Array.isArray(s[K.NOTES])) await setLocal({ [K.NOTES]: [] });
  document.querySelector('#addBtn').addEventListener('click', addActiveTab);
  document.querySelector('#newBtn').addEventListener('click', newBlankNote);
  byId('searchInput').addEventListener('input', (e) => {
    searchQ = e.target.value.trim();
    render();
  });
  byId('exportMdBtn').addEventListener('click', exportMd);
  byId('exportJsonBtn').addEventListener('click', exportJson);
  await window.__cnApply(document);
  await render();
}

init();