import { parseProfile, STATS } from './scaling.mjs';

export const WIKI = 'https://vsbattles.fandom.com';
export const wikiPage = title => `${WIKI}/wiki/${encodeURIComponent(title.replaceAll(' ', '_'))}`;
export const wikiRevision = profile => profile.revision ? `${WIKI}/wiki/Special:PermanentLink/${profile.revision}` : wikiPage(profile.title);
export const canonLinks = {
  2169: 'https://www.marvel.com/characters/spider-man-peter-parker/in-comics',
  2443507: 'https://en.dragon-ball-official.com/news/01_1574.html',
  3424600: 'https://en.dragon-ball-official.com/news/01_1574.html',
};

export async function wikiRequest(params, signal = AbortSignal.timeout(12000)) {
  const url = new URL('/api.php', WIKI);
  url.search = new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', origin: '*', ...params });
  const response = await fetch(url, { signal });
  if (!response.ok) throw Error(`Wiki returned HTTP ${response.status}.`);
  const data = await response.json();
  if (data.error) throw Error(data.error.info || 'The wiki returned an error.');
  return data;
}

export function toProfile(page) {
  const revision = page?.revisions?.[0];
  const raw = revision?.slots?.main?.content;
  if (!raw) throw Error('The wiki did not return profile text.');
  const parsed = parseProfile(raw);
  if (parsed.tierScope === 'missing' && !Object.keys(parsed.stats).length) {
    throw Error('This page has no readable power-scaling profile. Choose a character edition from the results.');
  }
  return {
    id: page.pageid, title: page.title, revision: revision.revid, updated: revision.timestamp,
    image: page.thumbnail?.source || '', categories: (page.categories || []).map(item => item.title.replace(/^Category:/, '')),
    ...parsed,
  };
}

export async function getProfile(id) {
  const data = await wikiRequest({
    pageids: id, redirects: '1', prop: 'revisions|pageimages|categories', rvprop: 'ids|timestamp|content',
    rvslots: 'main', piprop: 'thumbnail', pithumbsize: '320', cllimit: '100', clshow: '!hidden',
  });
  return toProfile(data.query?.pages?.[0]);
}

export async function searchWiki(query, signal) {
  const data = await wikiRequest({ list: 'search', srnamespace: '0', srlimit: '18', srprop: '', srsearch: query }, signal);
  return (data.query?.search || []).map(({ pageid, title }) => ({ id: pageid, title }));
}

export async function getPortrait(file) {
  const data = await wikiRequest({ titles: `File:${file}`, prop: 'imageinfo', iiprop: 'url', iiurlwidth: '320' });
  return data.query?.pages?.[0]?.imageinfo?.[0]?.thumburl || '';
}

export function adaptLegacy(backup) {
  if (backup.app !== 'VS Battles Character Explorer' || backup.format !== 1 || !Array.isArray(backup.index?.pages)) {
    throw Error('Choose a cache backup from the classic explorer.');
  }
  const rows = backup.index.pages.filter(page => Number.isInteger(page?.pageid) && page.pageid > 0 && typeof page.title === 'string');
  const roster = rows.map(page => ({ id: page.pageid, title: page.title }));
  const profiles = roster.flatMap(({ id, title }) => {
    const old = backup.profiles?.[id];
    if (!old || !Array.isArray(old.keys)) return [];
    const names = old.keys.length ? old.keys : ['Profile'];
    const stats = {};
    for (const field of STATS) {
      const item = old.stats?.[field];
      if (!Array.isArray(item?.parts)) continue;
      const scope = item.scope === 'keyed' || item.aligned ? 'keyed' : 'ambiguous';
      stats[field] = { scope, parts: item.parts.map(value => typeof value === 'string' ? value : '') };
    }
    return [{ id, title, origin: String(old.origin || ''), image: backup.images?.[id] || '', legacy: true,
      keys: names.map((name, i) => ({ name: String(name || `Key ${i + 1}`), rating: '',
        tiers: old.tierStatus === 'aligned' && Array.isArray(old.variants?.[i]?.tiers) ? old.variants[i].tiers.filter(tier => typeof tier === 'string') : [] })),
      tierScope: old.tierStatus === 'aligned' ? (old.keys.length ? 'keyed' : 'shared') : 'ambiguous', stats,
      portraits: (Array.isArray(old.portraits) ? old.portraits : []).filter(portrait => Array.isArray(portrait?.path)).map(portrait => ({
        path: portrait.path.map(String), image: portrait.image || '', file: String(portrait.file || ''),
      })),
      categories: Array.isArray(backup.compareCategories?.[id]) ? backup.compareCategories[id].map(value => String(value).replace(/^Category:/, '')) : [],
    }];
  });
  return { roster, profiles };
}
