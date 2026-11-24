export const TIERS = [
  '11-C', '11-B', '11-A', '10-C', '10-B', '10-A', '9-C', '9-B', '9-A',
  '8-C', 'High 8-C', '8-B', '8-A', 'Low 7-C', '7-C', 'High 7-C', 'Low 7-B', '7-B', '7-A', 'High 7-A',
  '6-C', 'High 6-C', 'Low 6-B', '6-B', 'High 6-B', '6-A', 'High 6-A', '5-C', 'Low 5-B', '5-B', '5-A', 'High 5-A',
  'Low 4-C', '4-C', 'High 4-C', '4-B', '4-A', '3-C', '3-B', '3-A', 'High 3-A',
  'Low 2-C', '2-C', '2-B', '2-A', 'Low 1-C', '1-C', 'High 1-C', '1-B', 'High 1-B', 'Low 1-A', '1-A', 'High 1-A', '0',
];

export const STATS = ['Attack Potency', 'Speed', 'Durability', 'Lifting Strength', 'Striking Strength', 'Range', 'Stamina', 'Intelligence', 'Powers and Abilities', 'Standard Equipment', 'Weaknesses'];
export const MAPPING_VERSION = 2;
const fields = ['Origin', 'Key', 'Tier', ...STATS];
const labels = new Map(fields.map(field => [field.toLowerCase(), field]));
labels.set('keys', 'Key');
labels.set('verse', 'Origin');
const tabbers = /<tabber\b[^>]*>([\s\S]*?)<\/tabber>/gi;

export function tierPosition(tier) {
  return TIERS.indexOf(tier.replace(/\+$/, ''));
}

export function stripReferences(text) {
  return text.replace(/<!--[\s\S]*?-->|<ref\b[^>]*\/>|<ref\b[^>]*>[\s\S]*?<\/ref>/gi, '');
}

function clean(text = '') {
  let value = text.replace(/\[\[([^\]]+?)\]\]/g, (_, link) => link.split('|').at(-1))
    .replace(/\[https?:\/\/[^\s\]]+(?:\s+([^\]]+))?\]/g, (_, label) => label || '')
    .replace(/\{\{!\}\}/g, '|');
  for (let pass = 0; pass < 8 && value.includes('{{'); pass++) {
    value = value.replace(/\{\{([^{}]*)\}\}/g, (_, body) => {
      const parts = body.split('|');
      return /^(color|colour|font.?color|span|hover|tooltip|nowrap|small|abbr)$/i.test(parts[0].trim())
        ? parts.at(-1) : parts[1] || parts[0];
    });
  }
  return value.replace(/<br\s*\/?\s*>/gi, ' · ').replace(/<[^>]*>|'{2,5}/g, '')
    .replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ').replace(/\s*·\s*$/g, '').trim();
}

export function splitColumns(raw = '') {
  const cells = [];
  let start = 0, templates = 0, links = 0, tag = false;
  for (let i = 0; i < raw.length; i++) {
    const pair = raw.slice(i, i + 2);
    if (pair === '{{') { templates++; i++; continue; }
    if (pair === '}}' && templates) { templates--; i++; continue; }
    if (pair === '[[') { links++; i++; continue; }
    if (pair === ']]' && links) { links--; i++; continue; }
    if (raw[i] === '<') tag = true;
    if (raw[i] === '>') tag = false;
    if (raw[i] === '|' && !templates && !links && !tag) {
      cells.push(raw.slice(start, i));
      start = i + 1;
    }
  }
  cells.push(raw.slice(start));
  return cells.slice(0, 30).map(clean);
}

function readFields(text) {
  const found = new Map();
  for (const line of text.split(/\r?\n/)) {
    const fieldLine = line.trim().replace(/^(?:\||[*#;])\s*/, '').replace(/'{2,5}|<\/?(?:strong|b)\b[^>]*>/gi, '')
      .replace(/^\[\[([^\]]+)\]\](?=\s*:)/, (_, label) => label.split('|').at(-1));
    const match = /^([^:=|]{1,75})\s*[:=]\s*(\S.*)$/.exec(fieldLine);
    const field = match && labels.get(match[1].trim().toLowerCase());
    if (!field) continue;
    const values = found.get(field) || [];
    values.push(match[2]);
    found.set(field, values);
  }
  return found;
}

function tabsIn(body) {
  return body.split(/(?:^|\n)\s*\|-\|/).flatMap(part => {
    const tab = /^\s*([^=\n]+)=([\s\S]*)$/.exec(part);
    return tab ? [{ name: clean(tab[1]).replace(/[▾▼]$/, '').trim(), text: tab[2] }] : [];
  });
}

function portraitsIn(summary) {
  const opening = /<tabber\b[^>]*>/i.exec(summary);
  if (!opening) return [];
  const first = /\[\[(?:File|Image):([^\]\n|]+)[\]|]/gi;
  return tabsIn(summary.slice(opening.index + opening[0].length).split(/<\/tabber>/i)[0]).flatMap(({ name, text }) => {
    const images = [...text.matchAll(first)];
    if (!images.length) return [];
    const nested = [...text.matchAll(/(?:\{\{!\}\}-\{\{!\}\}|^\s*\d+\s*=)\s*([^=\n|]{1,90})\s*=\s*\[\[(?:File|Image):([^\]\n|]+)[\]|]/gim)];
    return nested.length ? nested.map(match => ({ path: [name, clean(match[1])], file: match[2].trim() }))
      : [{ path: [name], file: images[0][1].trim() }];
  }).slice(0, 60);
}

function pairedTabs(groups, keys, portraits) {
  const normalize = text => text.toLowerCase();
  const names = keys.map(normalize);
  const aliases = portraits.flatMap(({ path }) => {
    const pair = path[0].split(/:\s+/);
    return pair.length === 2 ? [[normalize(pair[0]), normalize(pair[1])]] : [];
  });
  return groups.map(group => {
    const indices = group.map(({ name }) => {
      const index = names.indexOf(normalize(name));
      return index >= 0 && names.indexOf(normalize(name), index + 1) === -1 ? index : -1;
    });
    // A shortened label can fill its slot only in a complete, independently anchored tab set.
    const ordered = group.length === names.length && indices.filter((index, i) => index === i).length >= 2 &&
      group.every(({ name }, i) => {
        if (indices[i] >= 0) return indices[i] === i;
        const label = normalize(name);
        const prefix = label.includes(' ') && names[i].startsWith(`${label} `) &&
          names.filter(key => key === label || key.startsWith(`${label} `)).length === 1;
        const linked = aliases.some(([key, alias]) => key === names[i] && alias === label) &&
          aliases.filter(([, alias]) => alias === label).length === 1;
        return prefix || linked;
      });
    return group.map((entry, i) => ({ ...entry, index: ordered ? i : indices[i] }));
  });
}

function tabStats(groups, field, keys) {
  const values = keys.map(() => '');
  let seen = false;
  for (const group of groups) {
    for (const { index, fields: groupFields } of group) {
      const found = groupFields.get(field);
      if (!found) continue;
      seen = true;
      if (index < 0) continue;
      const [value, ...remaining] = found;
      if (remaining.length) continue;
      const text = clean(value).slice(0, 2400);
      if (values[index] && values[index] !== text) return { scope: 'ambiguous', parts: [] };
      values[index] = text;
    }
  }
  if (!seen) return null;
  return values.some(Boolean) ? { scope: 'keyed', parts: values } : { scope: 'ambiguous', parts: [] };
}

function flatStat(values, keyCount) {
  if (values.length > 1) return { scope: 'ambiguous', parts: [] };
  const parts = splitColumns(values[0]).map(value => value.slice(0, 2400));
  if (parts.length === 1) return { scope: 'shared', parts };
  return parts.length === keyCount ? { scope: 'keyed', parts } : { scope: 'ambiguous', parts: [] };
}

function tiersIn(text) {
  const ratings = text.match(/(?<![\w-])(?:(?:Low|High)\s+)?(?:1[01]|[0-9])(?:-[A-C])?\+?(?![\w-])/g) || [];
  return [...new Set(ratings.filter(tier => tierPosition(tier) >= 0))];
}

export function parseProfile(raw) {
  const source = stripReferences(raw);
  const heading = /^==\s*Powers and (?:Stats|Statistics)\s*==\s*$/im.exec(source);
  const summary = heading ? source.slice(0, heading.index) : source;
  const body = heading ? source.slice(heading.index + heading[0].length).split(/^==[^=].*?==\s*$/m)[0] : source;
  const fields = readFields(body.replace(tabbers, ''));
  const keys = splitColumns(fields.get('Key')?.[0]).filter((value, i, all) => value || all.length > 1);
  const tierCells = splitColumns(fields.get('Tier')?.[0]).filter((value, i, all) => value || all.length > 1);
  const aligned = tierCells.length === (keys.length || 1) && fields.get('Tier')?.length === 1;
  const portraits = portraitsIn(summary);
  const tabGroups = [...body.matchAll(tabbers)].map(([, block]) => tabsIn(block).map(tab => ({ name: tab.name, fields: readFields(tab.text) })));
  const groups = pairedTabs(tabGroups, keys, portraits);
  const stats = {};
  for (const field of STATS) {
    const flat = fields.has(field) ? flatStat(fields.get(field), keys.length) : null;
    const tabbed = tabStats(groups, field, keys);
    if (flat || tabbed) stats[field] = flat?.scope === 'keyed' ? flat : tabbed || flat;
  }
  return {
    mappingVersion: MAPPING_VERSION,
    origin: clean(fields.get('Origin')?.[0] || readFields(summary).get('Origin')?.[0]),
    keys: (keys.length ? keys : ['Profile']).map((name, i) => ({
      name: name || `Key ${i + 1}`, tiers: aligned ? tiersIn(tierCells[i]) : [], rating: aligned ? tierCells[i] : '',
    })),
    tierScope: aligned ? (keys.length ? 'keyed' : 'shared') : tierCells.length ? 'ambiguous' : 'missing',
    stats,
    portraits,
  };
}

export function statAt(profile, index, field) {
  const item = profile?.stats[field];
  if (!item) return { scope: 'missing', value: '' };
  if (item.scope === 'ambiguous') return { scope: 'ambiguous', value: '' };
  const value = item.parts[item.scope === 'shared' ? 0 : index];
  return value ? { scope: item.scope, value } : { scope: 'missing', value: '' };
}

export function matchesKey(profile, index, rules, combine) {
  const matches = rules.map(({ field, value }) => {
    if (field === 'Tier') return profile.keys[index].tiers.includes(value);
    if (field === 'Wiki category') return profile.categories.some(category => category.toLowerCase().includes(value.toLowerCase()));
    return statAt(profile, index, field).value.toLowerCase().includes(value.toLowerCase());
  });
  return combine === 'any' ? matches.some(Boolean) : matches.every(Boolean);
}
