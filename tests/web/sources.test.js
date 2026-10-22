// Tests for the web app's port of clearstream/sources.py. Run with:  node --test tests/web/
// The expected results are what the Python original gives for the same input.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../../web/js/sources.js');

const sorted = (a) => a.slice().sort();

test('classify matches the Python grouping', () => {
  assert.deepEqual(S.classify('FIFA+'), ['Football']);
  assert.deepEqual(S.classify('Canal Fútbol'), ['Football']);
  assert.deepEqual(S.classify('beIN SPORTS XTRA', false, true), ['Football']);
  assert.deepEqual(S.classify('Tennis Channel'), ['Tennis']);
  assert.deepEqual(S.classify('Willow Sports'), ['Cricket']);
  assert.deepEqual(S.classify('BBC News'), ['News']);
  assert.deepEqual(S.classify('Bloomberg TV'), ['News']);
  assert.deepEqual(S.classify('PGA Tour'), ['Sports']);
  assert.deepEqual(S.classify('Cartoon Fun'), ['Other']);
  assert.deepEqual(S.classify('Some channel', true), ['News']);
  assert.deepEqual(sorted(S.classify('Cricket News')), ['Cricket', 'News']);
  // Word boundaries: "goal" must start a word, "golazo" is matched on its own.
  assert.deepEqual(S.classify('Goalkeeper TV'), ['Football']);
  assert.deepEqual(S.classify('Ingoal TV'), ['Other']);
});

test('the free-list filter keeps official streams and drops pirate and insecure ones', () => {
  assert.equal(S.freeStreamAllowed('BBC News', false, 'https://vs-hls.example.co.uk/x.m3u8'), true);
  assert.equal(S.freeStreamAllowed('BBC News', false, 'http://vs-hls.example.co.uk/x.m3u8'), false);
  assert.equal(S.freeStreamAllowed('BBC News', false, 'https://203.0.113.9/x.m3u8'), false);
  assert.equal(S.freeStreamAllowed('BBC News', false, 'https://[2001:db8::1]/x.m3u8'), false);
  assert.equal(S.freeStreamAllowed('BBC News', false, 'https://cdn.jmp2.uk/x.m3u8'), false);
  assert.equal(S.freeStreamAllowed('Sky Sports Main Event', false, 'https://x.amagi.tv/a.m3u8'), false);
  assert.equal(S.freeStreamAllowed('beIN Sports 1', true, 'https://x.amagi.tv/a.m3u8'), false);
  assert.equal(S.freeStreamAllowed('beIN Sports XTRA', true, 'https://x.amagi.tv/a.m3u8'), true);
  assert.equal(S.freeStreamAllowed('FIFA+', true, 'https://fifa.amagi.tv/a.m3u8'), true);
  assert.equal(S.freeStreamAllowed('FIFA+', true, 'https://some-random-host.tv/a.m3u8'), false);
  assert.equal(S.freeStreamAllowed('Willow', true, 'https://x.amagi.tv/a.m3u8'), false);
});

test('buildFreeChannels applies country, category, blocklist and grouping rules', () => {
  const channels = [
    { id: 'FIFAPlus.uk', name: 'FIFA+', country: 'UK', categories: ['sports'], alt_names: [] },
    { id: 'BBCNews.uk', name: 'BBC News', country: 'UK', categories: ['news'] },
    { id: 'DDSports.in', name: 'DD Sports', country: 'IN', categories: ['sports'] },
    { id: 'Closed.uk', name: 'Closed News', country: 'UK', categories: ['news'], closed: '2020-01-01' },
    { id: 'Adult.uk', name: 'Late News', country: 'UK', categories: ['news'], is_nsfw: true },
    { id: 'Blocked.uk', name: 'Blocked News', country: 'UK', categories: ['news'] },
    { id: 'Movies.uk', name: 'Movie Box', country: 'UK', categories: ['movies'] },
    { id: 'Elsewhere.fr', name: 'France 24', country: 'FR', categories: ['news'] },
  ];
  const streams = [
    { channel: 'BBCNews.uk', url: 'https://a.example.com/geo.m3u8', labels: ['Geo-blocked'] },
    { channel: 'BBCNews.uk', url: ' https://b.example.com/ok.m3u8 ', user_agent: 'UA', referrer: null },
    { channel: 'BBCNews.uk', url: 'https://b.example.com/ok.m3u8' },
    { channel: 'FIFAPlus.uk', url: 'https://fifa.amagi.tv/1.m3u8' },
    { channel: 'FIFAPlus.uk', url: 'https://pirate.example/1.m3u8' },
    { channel: 'DDSports.in', url: 'https://ddsports.akamaized.net/x.m3u8' },
    { channel: 'Closed.uk', url: 'https://c.example.com/x.m3u8' },
    { channel: 'Adult.uk', url: 'https://d.example.com/x.m3u8' },
    { channel: 'Blocked.uk', url: 'https://e.example.com/x.m3u8' },
    { channel: 'Movies.uk', url: 'https://f.example.com/x.m3u8' },
    { channel: 'Elsewhere.fr', url: 'https://g.example.com/x.m3u8' },
    { channel: null, url: 'https://h.example.com/x.m3u8' },
  ];
  const result = S.buildFreeChannels(channels, streams, [{ channel: 'Blocked.uk' }], ['UK', 'IN']);
  const byKey = Object.fromEntries(result.map((c) => [c.key, c]));
  assert.deepEqual(Object.keys(byKey).sort(), ['free:BBCNews.uk', 'free:DDSports.in', 'free:FIFAPlus.uk']);
  assert.deepEqual(byKey['free:BBCNews.uk'].streams.map((s) => s.url),
                   ['https://b.example.com/ok.m3u8', 'https://a.example.com/geo.m3u8']);   // geo-blocked last
  assert.equal(byKey['free:BBCNews.uk'].streams[0].userAgent, 'UA');
  assert.deepEqual(byKey['free:BBCNews.uk'].groups, ['News']);
  assert.deepEqual(byKey['free:FIFAPlus.uk'].groups, ['Football']);
  assert.equal(byKey['free:FIFAPlus.uk'].streams.length, 1);
  assert.deepEqual(byKey['free:DDSports.in'].groups, ['Cricket']);   // national sports channel extra
  assert.equal(byKey['free:DDSports.in'].free, true);
});

test('parseM3U reads only names, known attributes and web addresses', () => {
  const text = [
    '#EXTM3U x-tvg-url="https://epg.example.com/guide.xml.gz,ftp://bad.example/x"',
    '#EXTINF:-1 tvg-id="bbc1.uk" tvg-country="gb" tvg-logo="https://logo.example/b.png" group-title="UK, Sport",BBC One HD',
    '#EXTVLCOPT:http-user-agent=Mozilla/5.0',
    '#EXTVLCOPT:file-caching=1000',
    '#EXTVLCOPT:http-referrer=https://example.com/',
    'http://provider.example:8080/live/u/p/1.m3u8',
    '#EXTINF:-1 tvg-id="bbc1.uk",BBC One (backup)',
    'https://provider.example/live/u/p/1b.m3u8',
    '#EXTINF:-1,Sky Sports Football FHD',
    '#EXTGRP:Football',
    'http://provider.example/live/u/p/2.ts',
    '#EXTINF:-1 group-title="Movies",Some Film',
    'http://provider.example/movie/u/p/3.mp4',
    '#EXTINF:-1,Bad',
    'file:///etc/passwd',
    '#EXTINF:-1 tvg-name="Fútbol Canal",',
    'https://x.example/futbol.m3u8',
  ].join('\r\n');
  const { channels, epgUrls } = S.parseM3U(text, 'src1', 'My TV');
  assert.deepEqual(epgUrls, ['https://epg.example.com/guide.xml.gz']);
  assert.deepEqual(channels.map((c) => c.key), ['src1:bbc one', 'src1:sky sports football', 'src1:fútbol canal']);
  const bbc = channels[0];
  assert.equal(bbc.name, 'BBC One HD');
  assert.equal(bbc.country, 'GB');
  assert.equal(bbc.epgId, 'bbc1.uk');
  assert.equal(bbc.logo, 'https://logo.example/b.png');
  assert.deepEqual(bbc.groups, ['Sports']);
  assert.deepEqual(bbc.streams.map((s) => [s.url, s.userAgent, s.referrer]), [
    ['http://provider.example:8080/live/u/p/1.m3u8', 'Mozilla/5.0', 'https://example.com/'],
    ['https://provider.example/live/u/p/1b.m3u8', '', ''],
  ]);
  assert.deepEqual(channels[1].groups, ['Football']);
  assert.equal(channels[2].name, 'Fútbol Canal');
  assert.equal(channels.every((c) => c.free === false), true);
});

test('streams are ordered working first, then unchecked, then dead', () => {
  const ch = { streams: [{ url: 'a', status: 'dead' }, { url: 'b', status: 'unknown' }, { url: 'c', status: 'ok' },
                         { url: 'd', status: 'unknown' }] };
  assert.deepEqual(S.orderedStreams(ch).map((s) => s.url), ['c', 'b', 'd', 'a']);
  assert.equal(S.channelStatus(ch), 'ok');
  assert.equal(S.channelStatus({ streams: [{ status: 'dead' }] }), 'dead');
  assert.equal(S.channelStatus({ streams: [{ status: 'dead' }, { status: 'unknown' }] }), 'unknown');
});

test('httpsFirst tries the encrypted address first', () => {
  assert.deepEqual(S.httpsFirst('http://a.example/x'), ['https://a.example/x', 'http://a.example/x']);
  assert.deepEqual(S.httpsFirst('https://a.example/x'), ['https://a.example/x']);
});
