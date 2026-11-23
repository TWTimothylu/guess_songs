// 為 songs.js 每首歌找 Apple Music（iTunes Search API）的 30 秒官方試聽。
//
// 用法：node tools/find_previews.mjs [songs.js] [out.json]
//
// 在美國區搜尋，比對曲名、作曲／演唱者，以及專輯名稱是否為該電影的原聲帶；
// 避開翻唱、Karaoke、Live、鋼琴版、搖籃曲版、Remix 等。
// 輸出 trackId、previewUrl、trackViewUrl 與比對到的曲名／歌手／專輯，請人工檢查 score 低的項目，
// 修正寫進 tools/build_songs.mjs 的 OVERRIDES。
// iTunes API 每分鐘約 20 次請求上限，所以每次請求間隔 3.2 秒。

import { readFileSync, writeFileSync } from 'node:fs';

const [src = 'songs.js', outPath = 'tools/previews.json'] = process.argv.slice(2);
const text = readFileSync(src, 'utf8');
const SONGS = new Function(text.slice(text.indexOf('const SONGS')).replace(/const SONGS\s*=/, 'return '))();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 去掉括號註記、空白、標點，統一全形半形與大小寫
const norm = (s) => (s || '')
  .normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .replace(/[（(【\[].*?[）)】\]]/g, '')
  .replace(/^the /, '')
  .replace(/[^a-z0-9぀-鿿]/g, '');

function similar(a, b) {
  a = norm(a); b = norm(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.8;
  const set = new Set(b);
  const hit = [...a].filter((c) => set.has(c)).length;
  return 0.6 * hit / Math.max(a.length, b.length);
}

async function search(term) {
  const url = `https://itunes.apple.com/search?country=US&media=music&entity=song&limit=25&term=${encodeURIComponent(term)}`;
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url);
      if (r.status === 403 || r.status === 429) { await sleep(20000); continue; }
      return (await r.json()).results || [];
    } catch { await sleep(3000); }
  }
  return [];
}

const COVER = /karaoke|made famous|in the style of|tribute|cover|lullaby|8-?bit|piano (version|arrangement)|music box|remix|live( at| from|\)|$)|workout|ringtone|re-?record/i;

function pick(song, results) {
  const track = song.track.replace(/\(.*?\)/g, '').trim();
  const people = song.composer.split(/[/&,]| and /).map((x) => x.trim()).filter(Boolean);
  let best = null;
  for (const r of results) {
    if (!r.previewUrl) continue;
    const t = similar(r.trackName, track);
    const a = Math.max(...people.map((p) => similar(r.artistName, p)));
    // 專輯是不是這部電影的原聲帶
    const m = Math.max(similar(r.collectionName, song.en), similar(r.trackName, song.en) * 0.6);
    let bad = COVER.test(`${r.trackName} ${r.collectionName} ${r.artistName}`) ? 0.5 : 0;
    // 主題曲不要純音樂版；配樂本身就是純音樂，不扣分
    if (song.type === 'song' && /instrumental/i.test(r.trackName)) bad += 0.5;
    const score = t * 0.45 + a * 0.25 + m * 0.30 - bad;
    if (!best || score > best.score) best = { r, score };
  }
  return best;
}

const out = [];
for (const [i, song] of SONGS.entries()) {
  const track = song.track.replace(/\(.*?\)/g, '').trim();
  const terms = [`${song.en} ${track}`, `${song.composer.split(/[/&,]/)[0]} ${track}`, `${track} ${song.en} soundtrack`];
  let best = null;
  for (const term of terms) {
    const b = pick(song, await search(term));
    await sleep(3200);
    if (b && (!best || b.score > best.score)) best = b;
    if (best && best.score >= 0.85) break;
  }
  const row = { i, en: song.en, track: song.track, composer: song.composer };
  if (best) {
    Object.assign(row, {
      score: Number(best.score.toFixed(2)),
      matchTrack: best.r.trackName, matchArtist: best.r.artistName, matchAlbum: best.r.collectionName,
      trackId: best.r.trackId, previewUrl: best.r.previewUrl, appleUrl: best.r.trackViewUrl,
    });
  }
  out.push(row);
  console.log(`${String(i).padStart(2)} ${row.score ?? '--'}  ${song.en} / ${song.track}  =>  ${row.matchTrack ?? 'NOT FOUND'} / ${row.matchArtist ?? ''} / ${row.matchAlbum ?? ''}`);
  writeFileSync(outPath, JSON.stringify(out, null, 1));
}
console.log(`\n${out.filter((r) => r.previewUrl).length} / ${SONGS.length} found`);
