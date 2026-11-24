import { parseProfile, STATS } from './scaling.mjs?v=2';

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

export async function getProfile(id, revision = 0) {
  const page = revision ? { revids: revision } : { pageids: id, redirects: '1' };
  const data = await wikiRequest({
    ...page, prop: 'revisions|pageimages|categories', rvprop: 'ids|timestamp|content',
    rvslots: 'main', piprop: 'thumbnail', pithumbsize: '320', cllimit: '100', clshow: '!hidden',
  });
  const result = data.query?.pages?.[0];
  if (revision && (result?.pageid !== id || result.revisions?.[0]?.revid !== revision)) throw Error(`Wiki revision ${revision} is unavailable for this character.`);
  return toProfile(result);
}

export async function searchWiki(query, signal) {
  const data = await wikiRequest({ list: 'search', srnamespace: '0', srlimit: '18', srprop: '', srsearch: query }, signal);
  return (data.query?.search || []).map(({ pageid, title }) => ({ id: pageid, title }));
}

export async function getCharacterIndex(onProgress) {
  const source = 'Category:Characters';
  const pages = new Map();
  let continuation;
  do {
    const response = await wikiRequest({ list: 'categorymembers', cmtitle: source, cmtype: 'page',
      cmnamespace: '0', cmlimit: '500', cmprop: 'ids|title', ...continuation });
    const members = response.query?.categorymembers;
    if (!Array.isArray(members)) throw Error('The wiki did not return character pages.');
    for (const { pageid, title, ns } of members) if (ns === 0 && Number.isInteger(pageid) && typeof title === 'string') pages.set(pageid, title);
    if (response.continue && (!response.continue.cmcontinue || response.continue.cmcontinue === continuation?.cmcontinue)) {
      throw Error('The wiki stopped paging through the character index.');
    }
    continuation = response.continue;
    onProgress?.(pages.size);
  } while (continuation);
  if (!pages.size) throw Error('The wiki returned an empty character index.');
  return { source, checkedAt: new Date().toISOString(), pages: [...pages] };
}

export async function getPortrait(file) {
  const data = await wikiRequest({ titles: `File:${file}`, prop: 'imageinfo', iiprop: 'url', iiurlwidth: '320' });
  return data.query?.pages?.[0]?.imageinfo?.[0]?.thumburl || '';
}

export function isCharacterIndex(index) {
  return index?.source === 'Category:Characters' &&
    (index.checkedAt == null || Number.isFinite(Date.parse(index.checkedAt))) &&
    Array.isArray(index.pages) && index.pages.length > 0 &&
    index.pages.every(page => Array.isArray(page) && Number.isInteger(page[0]) && page[0] > 0 && typeof page[1] === 'string' && page[1].length > 0);
}

export function classicDirectory(index) {
  if (index?.complete !== true || !Array.isArray(index.pages) || !index.pages.length ||
    !index.pages.every(page => page?.ns === 0 && Number.isInteger(page.pageid) && page.pageid > 0 && typeof page.title === 'string' && page.title.length)) return null;
  const date = new Date(Number(index.checkedAt || index.at || index.builtAt));
  return { source: 'Category:Characters', checkedAt: Number.isFinite(+date) ? date.toISOString() : null,
    pages: index.pages.map(({ pageid, title }) => [pageid, title]) };
}

export function adaptLegacy(backup) {
  if (backup?.app !== 'VS Battles Character Explorer' || backup.format !== 1 || !Array.isArray(backup.index?.pages)) {
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
  return { roster, profiles, directory: classicDirectory(backup.index) };
}
