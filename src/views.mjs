import { STATS, TIERS, statAt, tierPosition } from './scaling.mjs';
import { canonLinks, wikiPage, wikiRevision } from './wiki.mjs';

const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escape = (value = '') => String(value).replace(/[&<>"']/g, character => entities[character]);

export function portrait(title, image) {
  const initials = title.split(/[\s(]+/).slice(0, 2).map(word => word[0]).join('').toUpperCase();
  const url = typeof image === 'string' && image.startsWith('https://')
    ? image.replace(/^(https:\/\/static\.wikia\.nocookie\.net\/[^?]+\/scale-to-width-down\/)\d+(?=\?|$)/,
        (_, prefix) => `${prefix}160`)
    : '';
  return `<span class="portrait"><span aria-hidden="true">${escape(initials)}</span>${url ? `<img src="${escape(url)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}</span>`;
}

export function keyOptions(profile, index) {
  return profile.keys.map((key, i) => `<option value="${i}" ${i === index ? 'selected' : ''}>${escape(key.name)}</option>`).join('');
}

export function portraitOptions(profile, index) {
  const options = profile.portraits.map((item, i) => `<option value="${i + 1}" ${i + 1 === index ? 'selected' : ''}>${escape(item.path.join(' / '))}</option>`);
  return `<option value="0">Default portrait</option>${options.join('')}`;
}

export function sourceLinks(profile) {
  const canon = canonLinks[profile.id];
  const date = profile.updated?.slice(0, 10);
  return `<div class="evidence-links"><a href="${escape(wikiPage(profile.title))}" target="_blank" rel="noopener noreferrer">Wiki profile</a>
    ${profile.revision ? `<a href="${escape(wikiRevision(profile))}" target="_blank" rel="noopener noreferrer">Wiki revision${date ? ` · ${escape(date)}` : ''}</a>` : ''}
    ${canon ? `<a href="${escape(canon)}" target="_blank" rel="noopener noreferrer">Official source</a>` : ''}</div>`;
}

export function describeSelection({ profile, key, appearance }) {
  const selected = profile.keys[key];
  const selectedPortrait = profile.portraits[appearance - 1];
  return `${profile.title}${selected.name === 'Profile' ? '' : ` (${selected.name})`}${selectedPortrait ? ` [Appearance: ${selectedPortrait.path.join(' / ')}]` : ''}`;
}

function shownTiers(marked, full) {
  if (full) return [...TIERS].reverse();
  const rows = [...marked].map(tierPosition).filter(index => index >= 0).sort((a, b) => b - a);
  const visible = [];
  for (const [i, index] of rows.entries()) {
    visible.push(TIERS[index]);
    const gap = rows[i + 1] === undefined ? 0 : index - rows[i + 1] - 1;
    if (gap === 1) visible.push(TIERS[index - 1]);
    if (gap > 1) visible.push(gap);
  }
  return visible;
}

export function tierChart(sides, full) {
  const placements = sides.map(({ profile, key }) => profile.keys[key].tiers);
  const marks = new Set(placements.flat().map(tier => tier.replace(/\+$/, '')));
  if (!marks.size && !full) return '<p class="empty">No explicit tier ratings are mapped to these Keys.</p>';
  return `<div class="tier-grid${full ? ' full' : ''}" role="table" aria-label="Tier placement chart">
    <div role="row"><span role="columnheader">Tier</span><span role="columnheader">Character A</span><span role="columnheader">Character B</span></div>
    ${shownTiers(marks, full).map(tier => typeof tier === 'number'
      ? `<div class="gap" role="row"><span role="rowheader">${tier} omitted</span><span role="cell">·</span><span role="cell">·</span></div>`
      : `<div role="row"><span role="rowheader">${tier}</span>${placements.map((items, i) => {
        const ratings = items.filter(item => item.replace(/\+$/, '') === tier);
        return `<span role="cell" class="side-${i ? 'b' : 'a'}${ratings.length ? ' placed' : ''}">${ratings.length ? escape(ratings.join(' / ')) : '·'}</span>`;
      }).join('')}</div>`).join('')}</div>`;
}

export function tierRelationship(sides) {
  const [a, b] = sides.map(({ profile, key }) => profile.keys[key].tiers);
  if (!a.length || !b.length) return '';
  const shared = a.filter(tier => b.includes(tier));
  if (shared.length) return `Shared ${shared.length === 1 ? 'rating' : 'ratings'}: ${shared.join(', ')}`;
  const [left, right] = [a, b].map(tiers => tiers.map(tierPosition));
  if (Math.min(...left) > Math.max(...right)) return 'All listed A tiers are above the listed B tiers.';
  if (Math.min(...right) > Math.max(...left)) return 'All listed B tiers are above the listed A tiers.';
  return 'The listed tier ranges overlap.';
}

export function coverageChart(sides) {
  return `<div class="coverage">${sides.map(({ profile, key }, i) => {
    const scopes = STATS.map(field => statAt(profile, key, field).scope);
    const keyed = scopes.filter(scope => scope === 'keyed').length;
    const shared = scopes.filter(scope => scope === 'shared').length;
    return `<div class="side-${i ? 'b' : 'a'}"><div class="coverage-label"><strong>${escape(profile.title)}</strong><span>${keyed + shared}/${STATS.length}</span></div>
      <div class="coverage-track" role="img" aria-label="${keyed} Key-specific fields, ${shared} shared fields, ${STATS.length - keyed - shared} unavailable"><span style="width:${keyed / STATS.length * 100}%"></span><span style="width:${shared / STATS.length * 100}%"></span></div></div>`;
  }).join('')}<div class="coverage-legend"><span><i></i>Key-specific</span><span><i class="shared-swatch"></i>Shared</span></div></div>`;
}

export function statRows(sides) {
  return ['Tier', ...STATS].map(field => ({ field, values: sides.map(({ profile, key }) => {
    if (field !== 'Tier') return statAt(profile, key, field);
    const selected = profile.keys[key];
    return { value: selected.rating || selected.tiers.join(', '), scope: profile.tierScope };
  }) }));
}

export function renderValue({ value, scope }) {
  if (!value) return `<span class="meta">${scope === 'ambiguous' ? 'Unmapped to Key' : 'Unavailable'}</span>`;
  const first = value.split(/\s*\(/)[0].trim();
  const short = first.length > 18 && first.length < 155 ? first : value.slice(0, 140).trimEnd();
  const text = short !== value ? `<details class="stat-value"><summary>${escape(short)}…</summary><p>${escape(value)}</p></details>` : escape(value);
  return text + (scope === 'shared' ? '<span class="scope">Shared profile value</span>' : '');
}

export function renderTable(sides, hideMissing, differencesOnly = false) {
  const rows = statRows(sides).filter(({ values: [a, b] }) =>
    (!hideMissing || a.value || b.value) && (!differencesOnly || a.value !== b.value || a.scope !== b.scope));
  if (!rows.length) return `<p class="empty">${differencesOnly ? 'No differences match these table filters.' : 'None of the selected Keys have mapped values.'}</p>`;
  return `<table class="stats-table"><thead><tr><th scope="col">Statistic</th>${sides.map(({ profile, key }, i) =>
    `<th scope="col" class="side-${i ? 'b' : 'a'}">${escape(profile.title)}<small>${escape(profile.keys[key].name)}</small></th>`).join('')}</tr></thead>
    <tbody>${rows.map(({ field, values }) => `<tr><th scope="row">${field}</th>${values.map(value => `<td>${renderValue(value)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

export function comparisonCsv(sides) {
  const [a, b] = sides.map(describeSelection);
  const header = ['Statistic', a, 'A mapping', b, 'B mapping'];
  const rows = statRows(sides).map(({ field, values }) => [field, values[0].value, values[0].scope, values[1].value, values[1].scope]);
  rows.push(['Wiki revision', wikiRevision(sides[0].profile), '', wikiRevision(sides[1].profile), '']);
  return [header, ...rows].map(row => row.map(cell => `"${(/^\s*[=+@-]/.test(cell) ? `'${cell}` : cell).replaceAll('"', '""')}"`).join(',')).join('\r\n');
}
