import { MAPPING_VERSION, STATS, TIERS, matchesKey, statAt } from './scaling.mjs';
import { adaptLegacy, getPortrait, getProfile, searchWiki } from './wiki.mjs';
import { readLibrary, saveLibrary } from './cache.mjs';
import { comparisonCsv, coverageChart, describeSelection, escape, keyOptions, portrait, portraitOptions, renderTable, renderValue, sourceLinks, tierChart, tierRelationship } from './views.mjs';

const $ = id => document.getElementById(id);
const sides = ['left', 'right'];
const starterIds = [2443507, 3424600];
const portraits = new Map();
const profiles = new Map();
const revisions = new Map();
const roster = new Map();
const slots = [null, null];
const slotRequests = [0, 0];
const pageSize = 24;
const archiveApp = 'Character Tier Atlas';
let detail;
let routeVersion = 0;
let activeView;
let openingComparison = false;
let visibleCount = pageSize;
let wikiResults = [];
let exploreRequest;
let exploreQuery = '';

function message(id, text = '', error = false) {
  const node = $(id);
  node.textContent = text;
  node.dataset.error = String(error);
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
    <div class="selection-fields"><label class="field">Statistics Key<select data-slot-key="${i}">${keyOptions(profile, key)}</select></label>${portraitField(slot, `data-slot-appearance="${i}"`)}</div>${sourceLinks(profile)}`;
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

function localMatches(query) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return [...roster.values()].filter(row => {
    const p = profiles.get(row.id);
    const text = [row.title, p?.origin, p?.keys.map(key => key.name).join(' ')].join(' ').toLowerCase();
    return terms.every(term => text.includes(term));
  });
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
    const local = localMatches(query).slice(0, 14);
    try {
      const rows = mergedRows(local, await searchWiki(query, AbortSignal.any([search.signal, AbortSignal.timeout(12000)]))).slice(0, 18);
      if (!search.signal.aborted && query === input.value.trim()) show(rows, rows.length ? '' : 'No matches on the wiki.');
    } catch {
      if (!search.signal.aborted) show(local, 'Wiki search is unavailable.');
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
  const library = localMatches(exploreQuery);
  const available = mergedRows(library, wikiResults);
  const numIndexed = available.filter(row => profiles.has(row.id)).length;
  $('filterCoverage').hidden = !rules.length;
  $('filterCoverage').textContent = `${numIndexed} profiles checked · ${available.length - numIndexed} entries need profile data`;
  const rows = rules.length ? available.flatMap(row => {
    const profile = profiles.get(row.id);
    if (!profile) return [];
    const rulesMatch = profile.keys.flatMap((_, key) => matchesKey(profile, key, rules, combine) ? [key] : []);
    return rulesMatch.length ? [{ ...row, rulesMatch }] : [];
  }) : available;
  $('catalogPaging').hidden = rows.length <= visibleCount;
  $('showMore').textContent = `Show more (${Math.min(visibleCount, rows.length)} of ${rows.length})`;
  $('catalog').innerHTML = rows.slice(0, visibleCount).map(row => {
    const profile = profiles.get(row.id);
    const label = row.rulesMatch ? `${row.rulesMatch.length} matching ${row.rulesMatch.length === 1 ? 'Key' : 'Keys'}` : profile ? `${profile.keys.length} ${profile.keys.length === 1 ? 'Key' : 'Keys'}` : 'Wiki result';
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
  visibleCount = pageSize;
  renderCatalog();
  if (!query) { message('exploreNotice'); return; }
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
    message('exploreNotice', `${wikiResults.length} wiki results`);
  } catch {
    if (!controller.signal.aborted) message('exploreNotice', 'Wiki search is unavailable. Showing matches in your library.', true);
  }
}

function renderDetail() {
  const { profile, key } = detail;
  const selected = profile.keys[key];
  $('detailContent').innerHTML = `<div class="detail-head">${portrait(profile.title, portraitSource(detail))}<div><h1 id="detailTitle">${escape(profile.title)}</h1><p class="meta">${metadata(profile)}</p>${sourceLinks(profile)}</div></div>
    <div class="detail-grid"><section class="panel prose"><h2>Version and evidence</h2><div class="selection-fields">
      <label class="field">Statistics Key<select data-detail-key>${keyOptions(profile, key)}</select></label>${portraitField(detail, 'data-detail-appearance')}</div>
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
    $('detailContent').innerHTML = '<div class="page-heading"><h1 id="detailTitle">Profile unavailable</h1></div>';
    message('detailNotice', error.message, true);
  }
}

async function route() {
  const version = ++routeVersion;
  const [path, query] = location.hash.slice(1).split('?');
  const view = ['compare', 'explore', 'sources', 'detail'].includes(path) ? path : 'compare';
  for (const name of ['compare', 'explore', 'sources', 'detail']) $(name + 'View').hidden = name !== view;
  if (view !== activeView) document.documentElement.scrollTop = 0;
  activeView = view;
  for (const link of document.querySelectorAll('[data-nav]')) {
    if (link.dataset.nav === (view === 'detail' ? 'explore' : view)) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  const params = new URLSearchParams(query);
  openingComparison = false;
  if (view === 'explore') renderCatalog();
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
    const response = await fetch(new URL('./starter.json', import.meta.url));
    if (!response.ok) throw Error('Starter profiles did not load.');
    addProfiles(await response.json());
  } catch (error) { message('compareNotice', error.message, true); }
  try {
    for (const library of await readLibrary()) {
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
  $('showMore').addEventListener('click', () => { visibleCount += pageSize; renderCatalog(); });
  $('catalog').addEventListener('click', event => {
    const button = event.target.closest('[data-catalog-side]');
    if (button) setSlot(Number(button.dataset.catalogSide), Number(button.dataset.id), { key: Number(button.dataset.key), navigate: true });
  });
  $('addRule').addEventListener('click', addRule);
  $('clearRules').addEventListener('click', () => { $('rules').replaceChildren(); renderCatalog(); message('exploreNotice'); });
  $('filterRules').addEventListener('submit', event => { event.preventDefault(); renderCatalog(); });
  $('filterRules').addEventListener('change', event => {
    if (event.target.matches('.rule select:first-child')) {
      event.target.nextElementSibling.outerHTML = event.target.value === 'Tier'
        ? `<select aria-label="Filter value"><option value="">Select a tier</option>${[...TIERS].reverse().map(tier => `<option>${tier}</option>`).join('')}</select>`
        : '<input type="text" aria-label="Filter value" placeholder="Contains text">';
    }
    visibleCount = pageSize;
    renderCatalog();
  });
  $('rules').addEventListener('click', event => {
    const button = event.target.closest('[data-remove-rule]');
    if (button) { button.closest('.rule').remove(); renderCatalog(); }
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
