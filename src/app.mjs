import { MAPPING_VERSION, STATS, TIERS, matchesKey, statAt } from './scaling.mjs?v=2';
import { adaptLegacy, getCharacterIndex, getPortrait, getProfile, searchWiki, wikiPage } from './wiki.mjs?v=3';
import { readLibrary, saveLibrary } from './cache.mjs';
import { comparisonCsv, coverageChart, describeSelection, escape, keyOptions, portrait, portraitOptions, renderTable, renderValue, sourceLinks, tierChart, tierRelationship } from './views.mjs?v=2';

const $ = id => document.getElementById(id);
const sides = ['left', 'right'];
const starterIds = [2443507, 3424600];
const portraits = new Map();
const profiles = new Map();
const revisions = new Map();
const roster = new Map();
const directory = new Map();
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const formatCount = value => value.toLocaleString();
const slots = [null, null];
const slotRequests = [0, 0];
const pageSize = 24;
const archiveApp = 'Character Tier Atlas';
let detail;
let routeVersion = 0;
let activeView;
let openingComparison = false;
let catalogPage = 1;
let wikiResults = [];
let exploreRequest;
let exploreQuery = '';
let directoryTask;
let cachedDirectory;

function message(id, text = '', error = false) {
  const node = $(id);
  node.textContent = text;
  node.dataset.error = String(error);
}

function useDirectory(index) {
  if (index.source !== 'Category:Characters' || !index.pages?.length) throw Error('The character index is unavailable.');
  const pages = [...index.pages].sort((a, b) => collator.compare(a[1], b[1]));
  directory.clear();
  for (const [id, title] of pages) directory.set(id, { id, title, searchTitle: title.toLowerCase() });
  cachedDirectory = index;
  const date = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(index.checkedAt));
  message('directoryStatus', `${formatCount(directory.size)} character pages in the index · ${date}`);
  $('randomCharacter').disabled = false;
  if (activeView === 'explore') renderCatalog();
}

function loadDirectory(refresh = false) {
  if (directoryTask) return directoryTask;
  if (!refresh && directory.size) return Promise.resolve();
  $('refreshIndex').disabled = true;
  message('directoryStatus', refresh ? 'Refreshing the wiki index…' : 'Loading the full character index…');
  directoryTask = (async () => {
    try {
      if (refresh) {
        const index = await getCharacterIndex(count => message('directoryStatus', `Refreshing the wiki index · ${formatCount(count)} pages found`));
        useDirectory(index);
        try { await saveLibrary('directory', { directory: index }); }
        catch { message('directoryStatus', `${formatCount(directory.size)} character pages loaded for this session. Browser storage is unavailable.`, true); }
      } else if (cachedDirectory) useDirectory(cachedDirectory);
      else {
        const response = await fetch(new URL('./roster.json?v=1', import.meta.url));
        if (!response.ok) throw Error('The character index did not load.');
        useDirectory(await response.json());
      }
    } catch {
      message('directoryStatus', directory.size
        ? `The refresh stopped. The ${formatCount(directory.size)} pages already in your index are still available.`
        : 'The full index could not load. You can still search the wiki or retry with Refresh index.', true);
    } finally {
      $('refreshIndex').disabled = false;
    }
  })().finally(() => { directoryTask = undefined; });
  return directoryTask;
}

function addProfiles(rows) {
  for (const profile of rows) {
    const current = profiles.get(profile.id);
    if (!current || current.legacy || (!profile.legacy && (!profile.snapshot || current.snapshot) &&
      (profile.mappingVersion === MAPPING_VERSION || current.mappingVersion !== MAPPING_VERSION))) profiles.set(profile.id, profile);
    if (profile.revision && profile.mappingVersion === MAPPING_VERSION && (!profile.snapshot || !revisions.has(profile.revision))) revisions.set(profile.revision, profile);
    roster.set(profile.id, { id: profile.id, title: profile.title });
  }
}

async function profileFor(id, { refresh = false, revision = 0 } = {}) {
  if (revision) {
    const cached = revisions.get(revision);
    if (cached?.id === id) return cached;
    const profile = await getProfile(id, revision);
    revisions.set(revision, profile);
    return profile;
  }
  const cached = profiles.get(id);
  if (!refresh && (cached?.legacy || cached?.mappingVersion === MAPPING_VERSION)) return cached;
  try {
    const profile = await getProfile(id);
    addProfiles([profile]);
    if (profile.id !== id) profiles.set(id, profile);
    saveLibrary(`profile-${profile.id}`, { profiles: [profile] }).catch(() => {});
    return profile;
  } catch (error) {
    if (!refresh && cached) return cached;
    throw error;
  }
}

function selection(profile, key = 0, appearance = 0) {
  return { profile, key: profile.keys[key] ? key : 0, appearance: profile.portraits[appearance - 1] ? appearance : 0 };
}

function metadata(profile) {
  const version = profile.snapshot ? 'Starter snapshot' : profile.legacy ? 'Imported cache' : 'Wiki profile';
  return escape([profile.origin, version].filter(Boolean).join(' · '));
}

function portraitSource({ profile, appearance }) {
  const chosen = profile.portraits[appearance - 1];
  return chosen?.image || portraits.get(chosen?.file) || profile.image;
}

function portraitField(item, attribute) {
  return item.profile.portraits.length ? `<label class="field">Appearance<select ${attribute}>${portraitOptions(item.profile, item.appearance)}</select></label>` : '';
}

function detailsHash({ profile, key, appearance }) {
  return `#detail?${new URLSearchParams({ id: profile.id, key, appearance, ...(profile.revision ? { revision: profile.revision } : {}) })}`;
}

function renderSlot(i) {
  const slot = slots[i];
  const name = sides[i];
  $(name + 'Detail').hidden = !slot;
  if (!slot) {
    $(name + 'Card').innerHTML = '<p class="empty">Find a character to start comparing.</p>';
    return;
  }
  const { profile, key } = slot;
  $(name + 'Detail').href = detailsHash(slot);
  $(name + 'Card').innerHTML = `<div class="identity" data-slot-portrait>${portrait(profile.title, portraitSource(slot))}<div><h3>${escape(profile.title)}</h3><p class="meta">${metadata(profile)}</p></div></div>
    <div class="selection-fields"><label class="field">Version (Key)<select data-slot-key="${i}">${keyOptions(profile, key)}</select></label>${portraitField(slot, `data-slot-appearance="${i}"`)}</div>${sourceLinks(profile)}`;
  loadAppearance(slot, name + 'Card');
}

async function loadAppearance(item, container) {
  const { profile, appearance } = item;
  const chosen = profile.portraits[appearance - 1];
  if (!chosen?.file || chosen.image || portraits.has(chosen.file)) return;
  try {
    const image = await getPortrait(chosen.file);
    portraits.set(chosen.file, image);
    const current = container === 'detailContent' ? detail : slots[sides.indexOf(container.replace('Card', ''))];
    if (current === item && current.appearance === appearance) {
      const panel = $(container).querySelector('.portrait');
      if (panel) panel.outerHTML = portrait(profile.title, image || profile.image);
    }
  } catch {
    // The profile thumbnail stays visible when an appearance image does not load.
  }
}

function renderAnalysis() {
  const ready = slots.every(Boolean) && !openingComparison;
  for (const id of ['copyMatch', 'share', 'exportCsv', 'swap', 'jumpStats']) $(id).disabled = !ready;
  if (!ready) {
    $('tierChart').innerHTML = `<p class="empty">${openingComparison ? 'Opening linked comparison…' : 'Select two characters to see their tier placement.'}</p>`;
    $('coverageChart').innerHTML = '';
    $('statsTable').innerHTML = '';
    $('tierRelationship').textContent = '';
    return;
  }
  $('tierChart').innerHTML = tierChart(slots, $('showScale').checked);
  $('tierRelationship').textContent = tierRelationship(slots);
  $('coverageChart').innerHTML = coverageChart(slots);
  $('statsTable').innerHTML = renderTable(slots, $('hideMissing').checked, $('differencesOnly').checked);
}

function comparisonHash() {
  const params = new URLSearchParams();
  slots.forEach((slot, index) => {
    if (!slot) return;
    const { profile, key, appearance } = slot;
    const side = index ? 'b' : 'a';
    params.set(side, profile.id);
    params.set(side + 'Key', profile.keys[key].name);
    params.set(side + 'Index', key);
    if (profile.revision) params.set(side + 'Rev', profile.revision);
    if (appearance) params.set(side + 'Portrait', profile.portraits[appearance - 1].path.join(' / '));
  });
  return `#compare?${params}`;
}

function updateComparisonUrl() {
  if (!location.hash || location.hash.startsWith('#compare')) history.replaceState(null, '', comparisonHash());
}

function localMatches(query, libraryOnly = false) {
  const normalized = query.toLowerCase();
  const terms = normalized.split(/\s+/).filter(Boolean);
  const rows = libraryOnly || !directory.size ? [...roster.values()] : [...directory.values(), ...[...roster.values()].filter(row => !directory.has(row.id))];
  if (!terms.length) return rows;
  const matches = rows.filter(row => {
    const p = profiles.get(row.id);
    const title = row.searchTitle || row.title.toLowerCase();
    const text = p ? `${title} ${p.origin} ${p.keys.map(key => key.name).join(' ')}`.toLowerCase() : title;
    return terms.every(term => text.includes(term));
  });
  return matches.sort((a, b) => Number(b.title.toLowerCase().startsWith(normalized)) - Number(a.title.toLowerCase().startsWith(normalized)));
}

function mergedRows(first, second) {
  const rows = new Map(first.map(row => [row.id, row]));
  for (const row of second) if (!rows.has(row.id)) rows.set(row.id, row);
  return [...rows.values()];
}

async function setSlot(i, id, { selected, key = 0, navigate = false } = {}) {
  const request = ++slotRequests[i];
  const notice = navigate && activeView === 'explore' ? 'exploreNotice' : 'compareNotice';
  if (!selected) message(notice, 'Loading wiki profile…');
  try {
    const profile = selected?.profile || await profileFor(id);
    if (request !== slotRequests[i]) return;
    slots[i] = selected ? { ...selected } : selection(profile, key);
    $(sides[i] + 'Query').value = '';
    renderSlot(i);
    renderAnalysis();
    message(notice);
    $('compareManual').hidden = true;
    if (navigate) location.hash = comparisonHash();
    else updateComparisonUrl();
  } catch (error) {
    if (request === slotRequests[i]) message(notice, error.message, true);
  }
}

function bindPicker(name, i) {
  const input = $(name + 'Query');
  const results = $(name + 'Results');
  let controller;
  let timer;
  function close() {
    clearTimeout(timer);
    controller?.abort();
    results.hidden = true;
    input.setAttribute('aria-expanded', 'false');
  }
  function show(rows, status = '') {
    results.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    results.innerHTML = rows.map(row => `<button type="button" data-choose="${row.id}">${escape(row.title)}</button>`).join('') + (status ? `<p role="status">${escape(status)}</p>` : '');
  }
  async function find() {
    const query = input.value.trim();
    if (query.length < 2) return;
    controller?.abort();
    const search = new AbortController();
    controller = search;
    const index = loadDirectory();
    try {
      const live = await searchWiki(query, AbortSignal.any([search.signal, AbortSignal.timeout(12000)]));
      const rows = mergedRows(localMatches(query).slice(0, 14), live).slice(0, 18);
      if (!search.signal.aborted && query === input.value.trim()) show(rows, rows.length ? '' : 'No matches on the wiki.');
    } catch {
      await index;
      if (!search.signal.aborted) show(localMatches(query).slice(0, 14), 'Live wiki search is unavailable. Showing index matches.');
    }
  }
  input.setAttribute('aria-controls', results.id);
  input.setAttribute('aria-expanded', 'false');
  input.addEventListener('input', () => {
    close();
    const query = input.value.trim();
    if (query.length < 2) return;
    show(localMatches(query).slice(0, 14), 'Searching wiki…');
    timer = setTimeout(find, 300);
  });
  $(name + 'Search').addEventListener('submit', event => {
    event.preventDefault();
    clearTimeout(timer);
    if (input.value.trim().length >= 2) {
      show(localMatches(input.value.trim()).slice(0, 14), 'Searching wiki…');
      find();
    }
  });
  results.addEventListener('click', event => {
    const row = event.target.closest('[data-choose]');
    if (row) { close(); setSlot(i, Number(row.dataset.choose)); input.focus(); }
  });
  $(name + 'Search').addEventListener('keydown', event => {
    if (event.key === 'Escape') { close(); input.focus(); }
    if (event.target === input && event.key === 'ArrowDown' && !results.hidden) {
      event.preventDefault();
      results.querySelector('button')?.focus();
    }
  });
  document.addEventListener('click', event => { if (!$(name + 'Search').contains(event.target)) close(); });
}

async function copy(text, notice, fallback) {
  message(notice);
  $(fallback).hidden = true;
  try {
    await navigator.clipboard.writeText(text);
    message(notice, 'Copied to clipboard.');
  } catch {
    const field = $(fallback);
    field.hidden = false;
    field.value = text;
    field.focus();
    field.select();
    message(notice, 'Copy the selected text manually.');
  }
}

function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function rulesInUse() {
  return [...$('rules').querySelectorAll('.rule')].map(row => ({ field: row.firstElementChild.value, value: row.children[1].value.trim() })).filter(rule => rule.value);
}

function renderCatalog() {
  const rules = rulesInUse();
  const combine = $('filterCombine').value;
  const letter = $('indexLetter').value;
  const libraryOnly = $('libraryOnly').checked;
  const listed = localMatches(exploreQuery, libraryOnly);
  const available = (wikiResults.length && !libraryOnly ? mergedRows(listed, wikiResults) : listed).filter(row => {
    const initial = row.title.normalize('NFKD').charAt(0).toUpperCase();
    return !letter || (letter === '#' ? !/^[A-Z]$/.test(initial) : initial === letter);
  });
  const numIndexed = rules.length ? available.filter(row => profiles.has(row.id)).length : 0;
  $('filterCoverage').hidden = !rules.length;
  $('filterCoverage').textContent = `${formatCount(numIndexed)} profiles checked · ${formatCount(available.length - numIndexed)} entries need profile data`;
  const rows = rules.length ? available.flatMap(row => {
    const profile = profiles.get(row.id);
    if (!profile) return [];
    const rulesMatch = profile.keys.flatMap((_, key) => matchesKey(profile, key, rules, combine) ? [key] : []);
    return rulesMatch.length ? [{ ...row, rulesMatch }] : [];
  }) : available;
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  catalogPage = Math.min(catalogPage, totalPages);
  const first = (catalogPage - 1) * pageSize;
  $('catalogPaging').hidden = totalPages === 1;
  $('previousPage').disabled = catalogPage === 1;
  $('nextPage').disabled = catalogPage === totalPages;
  $('catalogPage').textContent = `Page ${formatCount(catalogPage)} of ${formatCount(totalPages)}`;
  $('catalogCount').textContent = rows.length ? `${formatCount(first + 1)}–${formatCount(Math.min(first + pageSize, rows.length))} of ${formatCount(rows.length)} entries` : '0 entries';
  $('catalog').innerHTML = rows.slice(first, first + pageSize).map(row => {
    const profile = profiles.get(row.id);
    const label = row.rulesMatch ? `${row.rulesMatch.length} matching ${row.rulesMatch.length === 1 ? 'Key' : 'Keys'}` : profile ? `${profile.keys.length} ${profile.keys.length === 1 ? 'Key' : 'Keys'}` : 'Open to load profile';
    const key = row.rulesMatch?.[0] || 0;
    const details = profile ? detailsHash(selection(profile, key)) : `#detail?${new URLSearchParams({ id: row.id })}`;
    const matching = row.rulesMatch ? `<p class="meta">${escape(row.rulesMatch.slice(0, 2).map(index => profile.keys[index].name).join(' · '))}${row.rulesMatch.length > 2 ? ' · …' : ''}</p>` : '';
    return `<article class="panel catalog-card"><div class="identity">${portrait(row.title, profile?.image)}<div><h3>${escape(row.title)}</h3><p class="meta">${escape(profile?.origin || label)}</p></div></div>
      ${profile ? `<div><p class="meta">${escape(label)}</p>${matching}</div>` : ''}<div class="actions"><a class="button secondary" href="${escape(details)}">View details</a>
      <button type="button" class="button text-button" data-catalog-side="0" data-id="${row.id}" data-key="${key}" aria-label="Use ${escape(row.title)} as A">Use as A</button>
      <button type="button" class="button text-button" data-catalog-side="1" data-id="${row.id}" data-key="${key}" aria-label="Use ${escape(row.title)} as B">Use as B</button></div></article>`;
  }).join('') || `<p class="empty">${rules.length ? 'No Keys in your library match these rules.' : 'No characters match your search.'}</p>`;
}

function addRule() {
  const row = document.createElement('div');
  row.className = 'rule';
  row.innerHTML = `<select aria-label="Filter field">${['Tier', 'Wiki category', ...STATS].map(field => `<option>${field}</option>`).join('')}</select><select aria-label="Filter value"><option value="">Select a tier</option>${[...TIERS].reverse().map(tier => `<option>${tier}</option>`).join('')}</select><button type="button" class="button secondary" data-remove-rule aria-label="Remove rule">Remove</button>`;
  $('rules').append(row);
  row.firstElementChild.focus();
}

async function exploreSearch(event) {
  event.preventDefault();
  exploreRequest?.abort();
  const controller = new AbortController();
  exploreRequest = controller;
  const query = $('exploreQuery').value.trim();
  exploreQuery = query;
  wikiResults = [];
  catalogPage = 1;
  renderCatalog();
  if (!query) { message('exploreNotice'); return; }
  if ($('libraryOnly').checked) { message('exploreNotice'); return; }
  if (rulesInUse().length) {
    message('exploreNotice', 'Showing verified matches from your library. Clear the rules to search the wiki.');
    return;
  }
  message('exploreNotice', 'Searching wiki…');
  try {
    const results = await searchWiki(query, AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]));
    if (controller.signal.aborted) return;
    wikiResults = results;
    renderCatalog();
    message('exploreNotice');
  } catch {
    if (!controller.signal.aborted) message('exploreNotice', 'Live wiki search is unavailable. Showing matches from the index and library.', true);
  }
}

function renderDetail() {
  const { profile, key } = detail;
  const selected = profile.keys[key];
  $('detailContent').innerHTML = `<div class="detail-head">${portrait(profile.title, portraitSource(detail))}<div><h1 id="detailTitle">${escape(profile.title)}</h1><p class="meta">${metadata(profile)}</p>${sourceLinks(profile)}</div></div>
    <div class="detail-grid"><section class="panel prose"><h2>Version and evidence</h2><div class="selection-fields">
      <label class="field">Version (Key)<select data-detail-key>${keyOptions(profile, key)}</select></label>${portraitField(detail, 'data-detail-appearance')}</div>
      ${selected.tiers.length ? `<div class="tags" aria-label="Tier ratings">${selected.tiers.map(tier => `<span>${escape(tier)}</span>`).join('')}</div>` : ''}
      <p>${selected.rating ? escape(selected.rating) : selected.tiers.length ? 'Refresh to read the current tier rating text.' : 'No tier rating is mapped to this Key.'}</p>
      <div class="actions"><button type="button" class="button primary" data-detail-copy>Copy selection</button><button type="button" class="button secondary" data-to-slot="0">Use as A</button><button type="button" class="button secondary" data-to-slot="1">Use as B</button></div></section>
    <section class="panel prose"><h2>Profile information</h2><p>${profile.snapshot ? 'This starter snapshot comes from the wiki revision above.' : profile.legacy ? 'This profile was imported from a classic backup.' : 'This profile was read from the wiki revision above.'}</p>
      <button type="button" class="button secondary" data-detail-refresh>Refresh from wiki</button>
      ${profile.categories.length ? `<details class="detail-versions"><summary>Wiki categories (${profile.categories.length})</summary><div class="tags">${profile.categories.map(category => `<span>${escape(category)}</span>`).join('')}</div></details>` : ''}</section></div>
    <section class="panel stats-panel"><div class="panel-heading"><h2>Selected Key stats</h2></div><table class="stats-table"><tbody>${STATS.map(field => `<tr><th scope="row">${field}</th><td>${renderValue(statAt(profile, key, field))}</td></tr>`).join('')}</tbody></table></section>`;
  loadAppearance(detail, 'detailContent');
}

function detailUrl() {
  history.replaceState(null, '', detailsHash(detail));
}

async function showDetail(id, key, appearance, revision, version) {
  detail = null;
  $('detailManual').hidden = true;
  message('detailNotice');
  $('detailContent').innerHTML = '<div class="page-heading"><h1 id="detailTitle">Loading profile</h1></div>';
  try {
    const profile = await profileFor(id, { revision });
    if (version !== routeVersion) return;
    detail = selection(profile, key, appearance);
    renderDetail();
  } catch (error) {
    if (version !== routeVersion) return;
    const entry = directory.get(id) || roster.get(id) || wikiResults.find(result => result.id === id);
    const wiki = entry ? `<a class="button secondary" href="${escape(wikiPage(entry.title))}" target="_blank" rel="noopener noreferrer">Open wiki page</a>` : '';
    $('detailContent').innerHTML = `<div class="page-heading"><h1 id="detailTitle">${escape(entry?.title || 'Profile unavailable')}</h1>${wiki}</div>`;
    message('detailNotice', error.message, true);
  }
}

async function route() {
  const version = ++routeVersion;
  const [path, query] = location.hash.slice(1).split('?');
  const view = ['compare', 'explore', 'sources', 'detail'].includes(path) ? path : 'explore';
  for (const name of ['compare', 'explore', 'sources', 'detail']) $(name + 'View').hidden = name !== view;
  if (view !== activeView) document.documentElement.scrollTop = 0;
  activeView = view;
  for (const link of document.querySelectorAll('[data-nav]')) {
    if (link.dataset.nav === (view === 'detail' ? 'explore' : view)) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  const params = new URLSearchParams(query);
  openingComparison = false;
  if (view === 'explore') {
    renderCatalog();
    loadDirectory();
  }
  if (view === 'detail') await showDetail(Number(params.get('id')), Number(params.get('key')), Number(params.get('appearance')), Number(params.get('revision')), version);
  if (view !== 'compare') return;
  if (query) {
    openingComparison = true;
    renderAnalysis();
    message('compareNotice', 'Opening linked comparison…');
    const currentRequests = [...slotRequests];
    const errors = await Promise.all(['a', 'b'].map(async (label, i) => {
      const id = Number(params.get(label));
      if (!id) return '';
      try {
        const profile = await profileFor(id, { revision: Number(params.get(label + 'Rev')) });
        if (version !== routeVersion || currentRequests[i] !== slotRequests[i]) return '';
        const keyName = params.get(label + 'Key');
        const index = Number(params.get(label + 'Index'));
        const key = profile.keys[index]?.name === keyName ? index : profile.keys.findIndex(item => item.name === keyName);
        const appearance = profile.portraits.findIndex(item => item.path.join(' / ') === params.get(label + 'Portrait')) + 1;
        if (keyName && key < 0) throw Error(`The linked Key is unavailable for ${profile.title}. Choose a Key for character ${label.toUpperCase()}.`);
        slots[i] = selection(profile, key, appearance);
        return params.has(label + 'Portrait') && !appearance ? `The linked appearance is unavailable for ${profile.title}.` : '';
      } catch (error) {
        if (version !== routeVersion || currentRequests[i] !== slotRequests[i]) return '';
        slots[i] = null;
        return error.message;
      }
    }));
    if (version !== routeVersion) return;
    openingComparison = false;
    message('compareNotice', errors.filter(Boolean).join(' '), errors.some(Boolean));
  }
  sides.forEach((_, i) => renderSlot(i));
  renderAnalysis();
}

async function init() {
  try {
    const response = await fetch(new URL('./starter.json?v=2', import.meta.url));
    if (!response.ok) throw Error('Starter profiles did not load.');
    addProfiles(await response.json());
  } catch (error) { message('compareNotice', error.message, true); }
  try {
    for (const library of await readLibrary()) {
      if (library.directory) { cachedDirectory = library.directory; continue; }
      (library.roster || []).forEach(row => roster.set(row.id, row));
      addProfiles(library.profiles);
    }
  } catch { /* The wiki and starter profiles can still work without storage. */ }
  starterIds.forEach((id, index) => { if (profiles.has(id)) slots[index] = selection(profiles.get(id)); });
  sides.forEach(bindPicker);
  sides.forEach((name, i) => $(name + 'Card').addEventListener('change', event => {
    const slot = slots[i];
    if (event.target.matches('[data-slot-key]')) {
      slot.key = Number(event.target.value);
      renderAnalysis();
    } else {
      slot.appearance = Number(event.target.value);
      $(name + 'Card').querySelector('.portrait').outerHTML = portrait(slot.profile.title, portraitSource(slot));
      loadAppearance(slot, name + 'Card');
    }
    $(name + 'Detail').href = detailsHash(slot);
    $('compareManual').hidden = true;
    message('compareNotice');
    updateComparisonUrl();
  }));
  $('copyMatch').addEventListener('click', () => copy(slots.map(describeSelection).join('\n'), 'compareNotice', 'compareManual'));
  $('share').addEventListener('click', () => copy(new URL(comparisonHash(), location.href).href, 'compareNotice', 'compareManual'));
  $('exportCsv').addEventListener('click', () => download('character-tier-comparison.csv', comparisonCsv(slots), 'text/csv;charset=utf-8'));
  $('showScale').addEventListener('change', renderAnalysis);
  $('hideMissing').addEventListener('change', renderAnalysis);
  $('differencesOnly').addEventListener('change', renderAnalysis);
  $('jumpStats').addEventListener('click', () => {
    $('statsTitle').focus({ preventScroll: true });
    $('statsTitle').scrollIntoView({ block: 'start' });
  });
  $('swap').addEventListener('click', () => {
    slots.reverse();
    sides.forEach((_, i) => { slotRequests[i]++; renderSlot(i); });
    renderAnalysis();
    updateComparisonUrl();
    message('compareNotice', 'Comparison sides swapped.');
  });
  $('exploreSearch').addEventListener('submit', exploreSearch);
  $('exploreQuery').addEventListener('search', event => { if (!event.target.value) exploreSearch(event); });
  $('indexLetter').insertAdjacentHTML('beforeend', [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ#'].map(letter => `<option>${letter}</option>`).join(''));
  for (const id of ['indexLetter', 'libraryOnly']) $(id).addEventListener('change', () => { catalogPage = 1; renderCatalog(); });
  $('refreshIndex').addEventListener('click', () => loadDirectory(true));
  $('randomCharacter').addEventListener('click', () => {
    const pages = cachedDirectory.pages;
    const [id] = pages[Math.floor(Math.random() * pages.length)];
    location.hash = `#detail?id=${id}`;
  });
  for (const [id, direction] of [['previousPage', -1], ['nextPage', 1]]) $(id).addEventListener('click', () => {
    catalogPage += direction;
    renderCatalog();
    $('catalogCount').focus();
    $('catalogCount').scrollIntoView({ block: 'start' });
  });
  $('catalog').addEventListener('click', event => {
    const button = event.target.closest('[data-catalog-side]');
    if (button) setSlot(Number(button.dataset.catalogSide), Number(button.dataset.id), { key: Number(button.dataset.key), navigate: true });
  });
  $('addRule').addEventListener('click', addRule);
  $('clearRules').addEventListener('click', () => { $('rules').replaceChildren(); catalogPage = 1; renderCatalog(); message('exploreNotice'); });
  $('filterRules').addEventListener('submit', event => { event.preventDefault(); renderCatalog(); });
  $('filterRules').addEventListener('change', event => {
    if (event.target.matches('.rule select:first-child')) {
      event.target.nextElementSibling.outerHTML = event.target.value === 'Tier'
        ? `<select aria-label="Filter value"><option value="">Select a tier</option>${[...TIERS].reverse().map(tier => `<option>${tier}</option>`).join('')}</select>`
        : '<input type="text" aria-label="Filter value" placeholder="Contains text">';
    }
    catalogPage = 1;
    renderCatalog();
  });
  $('rules').addEventListener('click', event => {
    const button = event.target.closest('[data-remove-rule]');
    if (button) { button.closest('.rule').remove(); catalogPage = 1; renderCatalog(); }
  });
  $('importButton').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', async event => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      const backup = JSON.parse(await file.text());
      const library = backup.app === archiveApp && backup.format === 1 && Array.isArray(backup.roster) && Array.isArray(backup.profiles)
        ? backup : adaptLegacy(backup);
      if (!library.profiles.every(profile => Number.isInteger(profile?.id) && typeof profile.title === 'string' && profile.keys?.length && profile.stats && Array.isArray(profile.portraits) && Array.isArray(profile.categories))) throw Error('This backup contains an invalid profile.');
      for (const row of library.roster) if (Number.isInteger(row?.id) && typeof row.title === 'string') roster.set(row.id, row);
      addProfiles(library.profiles);
      renderCatalog();
      try {
        await saveLibrary('imported', { roster: [...roster.values()], profiles: [...new Set(profiles.values())] });
        message('exploreNotice', `Imported ${library.roster.length} character entries and ${library.profiles.length} profiles.`);
      } catch { message('exploreNotice', 'Backup loaded for this session. Browser storage is unavailable.', true); }
    } catch (error) { message('exploreNotice', error.message, true); }
    finally { event.target.value = ''; }
  });
  $('exportLibrary').addEventListener('click', () => download('character-tier-atlas-library.json', JSON.stringify({
    app: archiveApp, format: 1, roster: [...roster.values()], profiles: [...new Set(profiles.values())],
  }), 'application/json'));
  $('detailContent').addEventListener('change', event => {
    const control = event.target.matches('[data-detail-key]') ? 'key' : 'appearance';
    detail[control] = Number(event.target.value);
    renderDetail();
    $('detailContent').querySelector(`[data-detail-${control}]`)?.focus();
    detailUrl();
    message('detailNotice');
    $('detailManual').hidden = true;
  });
  $('detailContent').addEventListener('click', async event => {
    const button = event.target.closest('button');
    if (!button || !detail) return;
    if (button.matches('[data-detail-copy]')) copy(describeSelection(detail), 'detailNotice', 'detailManual');
    if (button.matches('[data-to-slot]')) setSlot(Number(button.dataset.toSlot), detail.profile.id, { selected: detail, navigate: true });
    if (button.matches('[data-detail-refresh]')) {
      const current = detail;
      const version = routeVersion;
      button.disabled = true;
      message('detailNotice', 'Refreshing wiki profile…');
      try {
        const profile = await profileFor(current.profile.id, { refresh: true });
        if (version !== routeVersion || detail !== current) return;
        const key = profile.keys.findIndex(item => item.name === current.profile.keys[current.key].name);
        const appearance = profile.portraits.findIndex(item => item.file === current.profile.portraits[current.appearance - 1]?.file) + 1;
        detail = selection(profile, key, appearance);
        renderDetail();
        detailUrl();
        message('detailNotice', 'Profile refreshed.');
      } catch (error) {
        if (version === routeVersion && detail === current) { message('detailNotice', error.message, true); button.disabled = false; }
      }
    }
  });
  document.addEventListener('error', event => { if (event.target.matches?.('.portrait img')) event.target.remove(); }, true);
  window.addEventListener('hashchange', route);
  await route();
}

init();
