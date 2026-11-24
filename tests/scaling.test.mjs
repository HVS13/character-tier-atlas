import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { matchesKey, parseProfile, statAt } from '../src/scaling.mjs';
import { adaptLegacy, getCharacterIndex, getProfile, isCharacterIndex, toProfile } from '../src/wiki.mjs';
import { comparisonCsv, describeSelection, portrait, renderTable, tierChart, tierRelationship } from '../src/views.mjs';

test('reads top-level columns, preserves gaps and does not flatten ratings', () => {
  const profile = parseProfile(`==Powers and Stats==
'''[[Tiering System|Tier]]:''' {{8-C}} | At least {{7-A}}, possibly {{6-C}} | {{2-C}}
'''Key:''' [[Test|Base]] | [[World|Next]] | Last
'''[[Speed]]:''' Old <ref>link|ref</ref> | | New
'''Range:''' [[Distance|3 m]]
'''Attack Potency:''' Rating | Ambiguous
==Notes==
'''Speed:''' This section does not contain stats.`);
  assert.deepEqual(profile.keys.map(key => key.name), ['Base', 'Next', 'Last']);
  assert.deepEqual(profile.keys[1].tiers, ['7-A', '6-C']);
  assert.equal(statAt(profile, 0, 'Speed').value, 'Old');
  assert.equal(statAt(profile, 1, 'Speed').scope, 'missing');
  assert.equal(statAt(profile, 2, 'Speed').value, 'New');
  assert.equal(statAt(profile, 0, 'Range').scope, 'shared');
  assert.equal(statAt(profile, 1, 'Attack Potency').scope, 'ambiguous');
  assert.equal(matchesKey(profile, 0, [{ field: 'Tier', value: '8-C' }, { field: 'Speed', value: 'New' }], 'all'), false);
  assert.equal(matchesKey(profile, 2, [{ field: 'Tier', value: '8-C' }, { field: 'Speed', value: 'New' }], 'any'), true);
});

test('maps repeated stat tabs by exact Key label and keeps unmatched fields off each Key', () => {
  const { stats, portraits } = parseProfile(`<tabber>
Base=[[File:base.png]]
|-|Second=[[File:second.png]]
</tabber>
== Powers and Stats ==
'''Tier:''' {{7-A}} | {{6-B}} | {{4-B}}
'''Key:''' Base | Second | Third
<tabber>
Third='''[[Speed]]:''' Third speed
|-|Base=
'''[[Speed]]:''' Base speed
|-|Second and Third='''Speed:''' Mixed speed
</tabber>`);
  assert.deepEqual(stats.Speed, { scope: 'keyed', parts: ['Base speed', '', 'Third speed'] });
  assert.deepEqual(portraits.map(item => item.path), [['Base'], ['Second']]);
});

test('rejects an unparsed redirect as a character profile', () => {
  assert.throws(() => toProfile({ revisions: [{ slots: { main: { content: '#REDIRECT [[A]]' } } }] }), /no readable/);
});

test('maps a stat tab with an explicit alternate name or unique shortened Key', () => {
  const template = `<tabber>
Awakened Garou: Cosmic Fear Mode=[[File:cosmic.png]]
</tabber>
== Powers and Stats ==
'''Key:''' Hero Hunter | Half-Monster | Awakened Garou | Parallel Timeline Awakened Garou
'''Tier:''' 7-A | 6-B | 4-A | 4-A
<tabber>
Hero Hunter='''Speed:''' First
|-|Half-Monster='''Speed:''' Second
|-|Cosmic Fear Mode='''Speed:''' Third
|-|Parallel Timeline='''Speed:''' Fourth
</tabber>`;
  assert.deepEqual(parseProfile(template).stats.Speed.parts, ['First', 'Second', 'Third', 'Fourth']);
  const shifted = template.replace('Hero Hunter=', 'Swap=').replace('Half-Monster=', 'Hero Hunter=').replace('Swap=', 'Half-Monster=');
  assert.equal(statAt(parseProfile(shifted), 2, 'Speed').scope, 'missing');
});

test('requests a pinned revision and rejects a response for the wrong revision', async t => {
  const page = { pageid: 42, title: 'Fixture', revisions: [{ revid: 17, slots: { main: { content: 'Tier: 4-A' } } }] };
  const request = t.mock.method(globalThis, 'fetch', async () => Response.json({ query: { pages: [page] } }));
  assert.equal((await getProfile(42, 17)).revision, 17);
  const requestUrl = request.mock.calls[0].arguments[0];
  assert.equal(requestUrl.searchParams.get('revids'), '17');
  assert.equal(requestUrl.searchParams.has('pageids'), false);
  await assert.rejects(getProfile(42, 18), /Wiki revision 18 is unavailable/);
});

test('renders a small wiki thumbnail with no referrer', () => {
  const markup = portrait('Son Goku', 'https://static.wikia.nocookie.net/vsbattles/images/goku.png/revision/latest/scale-to-width-down/320?cb=1');
  assert.match(markup, /scale-to-width-down\/160\?cb=1/);
  assert.match(markup, /referrerpolicy="no-referrer"/);
});

test('loads all main-namespace roster pages and deduplicates continued results', async t => {
  const request = t.mock.method(globalThis, 'fetch', async url => {
    const next = url.searchParams.get('cmcontinue');
    assert.equal(url.searchParams.get('cmtitle'), 'Category:Characters');
    assert.equal(url.searchParams.get('cmnamespace'), '0');
    const members = [{ pageid: 1, ns: 0, title: 'First' }];
    if (next) members.push({ pageid: 2, ns: 0, title: 'Second' });
    return Response.json({ query: { categorymembers: members }, ...(next ? {} : { continue: { cmcontinue: 'next', continue: '-||' } }) });
  });
  const counts = [];
  const index = await getCharacterIndex(count => counts.push(count));
  assert.equal(request.mock.calls.length, 2);
  assert.deepEqual(counts, [1, 2]);
  assert.deepEqual(index.pages, [[1, 'First'], [2, 'Second']]);
});

test('ships the character directory separately from starter stat profiles', async () => {
  const { pages, source } = JSON.parse(await readFile(new URL('../src/roster.json', import.meta.url), 'utf8'));
  assert.equal(source, 'Category:Characters');
  assert(pages.length > 30000);
  assert.equal(new Set(pages.map(([id]) => id)).size, pages.length);
  assert(pages.some(([id, title]) => id === 104428 && title === 'Garou'));
});

test('imports classic backups with only attributable stats', () => {
  const { profiles, directory } = adaptLegacy({ app: 'VS Battles Character Explorer', format: 1,
    index: { complete: true, checkedAt: Date.parse('2026-11-24T01:00:00Z'), pages: [{ pageid: 13, ns: 0, title: 'Character' }] }, profiles: { 13: {
      origin: 'Test', keys: ['Base', 'Final'], tierStatus: 'aligned', variants: [{ tiers: ['8-A'] }, { tiers: ['7-A'] }],
      stats: { Speed: { scope: 'shared', parts: ['Example'] }, Range: { aligned: true, parts: ['Short', 'Long'] } },
    } },
  });
  assert.equal(statAt(profiles[0], 1, 'Range').value, 'Long');
  assert.equal(statAt(profiles[0], 1, 'Speed').scope, 'ambiguous');
  assert.deepEqual(directory.pages, [[13, 'Character']]);
  assert.equal(directory.checkedAt, '2026-11-24T01:00:00.000Z');
  assert(isCharacterIndex(directory));
  assert(!isCharacterIndex({ ...directory, pages: [[0, 'Invalid page']] }));
});

test('renders starter data with separate tier categories and exports selected Keys', async () => {
  const [a, b] = JSON.parse(await readFile(new URL('../src/starter.json', import.meta.url), 'utf8'));
  const sides = [{ profile: a, key: 0, appearance: 0 }, { profile: b, key: 0, appearance: 0 }];
  assert.equal(tierRelationship(sides), 'Shared rating: 4-B');
  assert.match(tierChart(sides, false), /2-C.+placed/s);
  assert.match(tierChart(sides, true), />11-C</);
  assert.match(comparisonCsv(sides), /Son Goku \(DBS Manga\) \(Battle of Gods\)/);
  assert.match(comparisonCsv(sides), /Special:PermanentLink/);
  assert.match(describeSelection({ ...sides[0], appearance: 1 }), /Appearance:/);
  assert.match(a.stats['Attack Potency'].parts[0], /Low Multiverse level/);
  assert.match(renderTable([sides[0], sides[0]], false, true), /No differences match/);
});
