// 把 tools/previews.json（find_previews.mjs 的結果）合併進 songs.js。
//
// 用法：node tools/build_songs.mjs
//
// OVERRIDES：人工檢查後修正的比對（翻唱、重新錄音版、錯的曲子等），
// 值為 Apple trackId（會向 iTunes Lookup API 查詢最新資料），也可同時修改歌曲欄位。
// 注意：挑戰連結用 SONGS 的索引記錄題目，所以不能刪除或重新排序歌曲，只能原地修正或加在最後。
import { readFileSync, writeFileSync } from 'node:fs';

const OVERRIDES = {
  4: { appleId: 205745391 },   // Titanic：自動比對到 Dialogue Mix，改原聲帶版
  8: { appleId: 1440829927 },  // Back to the Future：自動比對到翻奏，改官方原聲帶（Apple 標為 The Outatime Orchestra）
  12: { appleId: 1444100762, composer: 'Lalo Schifrin' }, // Mission: Impossible：1996 電影版主題在美區沒有上架，改用 Lalo Schifrin 原版主題
  15: { appleId: 418557001, track: 'Forrest Gump Suite' }, // Forrest Gump：自動比對到別首，改羽毛主題所在的組曲
  16: { appleId: 50235930 },   // Superman：自動比對到 Alternate Version
  25: { appleId: 1440864172, composer: 'Ryan Gosling & Emma Stone' }, // La La Land：自動比對到哼唱版
  26: { appleId: 1450958727 }, // Chariots of Fire：自動比對到舞台劇版，改電影原聲 Titles
  34: { appleId: 1452165089, composer: 'Richard Strauss（Karajan / Berlin Philharmonic）' }, // 2001：自動比對到不知名樂團
  43: { appleId: 1440671621 }, // Coco：改搖籃曲版 Remember Me (Lullaby)
  44: { appleId: 1440618907 }, // Beauty and the Beast：自動比對到 Demo
  45: { appleId: 1556829929 }, // Bourne Identity：自動比對到 Bourne Ultimatum 混音，改原版
  46: { appleId: 393996227 },  // Halloween：自動比對到 2018 新版，改 1978 原版
  47: { appleId: 1857320 },    // The Matrix：自動比對到弦樂四重奏翻奏，改 Rob Dougan 原版
  53: { appleId: 1440661297 }, // The Little Mermaid：自動比對到 Synth Demo
};

const text = readFileSync('songs.js', 'utf8');
const SONGS = new Function(text.slice(text.indexOf('const SONGS')).replace(/const SONGS\s*=/, 'return '))();
const previews = JSON.parse(readFileSync('tools/previews.json', 'utf8'));

async function lookup(id) {
  const r = await fetch(`https://itunes.apple.com/lookup?id=${id}&country=US`);
  const x = (await r.json()).results[0];
  if (!x || !x.previewUrl) throw new Error(`Apple ${id} 沒有試聽`);
  console.log(`lookup ${id}: ${x.trackName} / ${x.artistName} / ${x.collectionName}`);
  return { appleId: x.trackId, preview: x.previewUrl, appleUrl: x.trackViewUrl };
}

const out = [];
for (const [i, s] of SONGS.entries()) {
  const { hot, duration, appleId, preview, appleUrl, ...song } = s; // hot 是 YouTube 熱度圖用的，不再需要
  const o = OVERRIDES[i] || {};
  let apple = null;
  if (o.appleId) {
    apple = await lookup(o.appleId);
    await new Promise((r) => setTimeout(r, 3200));
  } else if (previews[i] && previews[i].previewUrl) {
    const p = previews[i];
    apple = { appleId: p.trackId, preview: p.previewUrl, appleUrl: p.appleUrl };
  }
  const { appleId: _, ...fields } = o;
  const merged = { ...song, ...fields };
  // 欄位順序：顯示資訊在前，Apple 與 YouTube 在後
  const { youtubeId, ...info } = merged;
  out.push({ ...info, ...(apple || { appleId: null, preview: null, appleUrl: null }), youtubeId });
  if (!apple) console.log(`!! ${i} ${s.en} 沒有試聽`);
}

const header = [
  '// 好萊塢電影配樂題庫：試聽來自 Apple Music（iTunes Search API），已人工確認為原聲帶／原唱版本。',
  '// type: score = 配樂 / song = 主題曲',
  '// appleId / preview / appleUrl：Apple Music 曲目 ID、30 秒試聽網址、Apple Music 頁面；youtubeId 只用於揭曉時的連結。',
  '// 挑戰連結用陣列索引記錄題目：新歌只能加在最後面，不要刪除或重新排序。',
  '',
].join('\n');
writeFileSync('songs.js', header + 'const SONGS = [\n' + out.map((s) => '  ' + JSON.stringify(s)).join(',\n') + '\n];\n');
console.log(`songs.js：${out.filter((s) => s.preview).length} / ${out.length} 首有試聽`);
