# 🎬 好萊塢配樂猜猜看

聽一段好萊塢電影配樂，從四個選項中猜出是哪一部電影。音樂使用 Apple Music（iTunes Search API）提供的官方 30 秒試聽，以網頁內建播放器播放——沒有廣告，手機鎖定畫面也只會顯示題號、不會洩漏片名。

線上遊玩：<https://twtimothylu.github.io/guess_songs/>

## 玩法

- **難度**：簡單（15 秒）／普通（10 秒）／困難（5 秒），片段從 30 秒試聽中隨機截取
- **題數**：5、10、20 題
- **題庫**：全部、純配樂、主題曲（共 68 首）
- 計分：答對 100 分 + 速度加分（最多 100）+ 連擊加分；各難度最高分存在瀏覽器中
- 快捷鍵：`1`–`4` 作答、`R` 再聽一次、`Enter` 下一題
- 作答後揭曉片名並繼續播放音樂，附 Apple Music 完整版與 YouTube 連結
- **分享成績圖**：結算頁可產生 IG 限時動態尺寸（1080×1920）的成績圖，含 QR Code；手機可直接分享到 IG，電腦可下載
- **邀請朋友挑戰**：產生挑戰連結（`?d=難度&q=題目索引&s=分數&c=答對數&n=名字`），朋友打開後用同一組題目、同樣難度作答，結算時顯示勝負。因為連結用的是 `songs.js` 的索引，新增歌曲請只加在陣列最後面
- **播放有問題？**：頁尾的 🐞 按鈕（或網址加 `?debug`）會開啟播放診斷，可重新載入、跳過，或複製診斷資訊。試聽網址失效時，遊戲會自動向 iTunes Lookup API 重新取得

## 本機執行

```powershell
python -m http.server 8000
```

然後開啟 <http://localhost:8000>。推到 `main` 分支後，GitHub Pages 會自動更新線上版。

## 檔案

| 檔案 | 說明 |
| --- | --- |
| `index.html` | 頁面結構（開始／遊戲／結算畫面、分享與診斷視窗） |
| `style.css` | 電影院風格樣式，支援手機版 |
| `game.js` | 遊戲邏輯、`<audio>` 播放控制與自動修復 |
| `share.js` | 成績分享圖（Canvas 繪製） |
| `songs.js` | 題庫：中英文片名、曲名、作曲者、年份、Apple Music 試聽、YouTube 影片 ID |
| `tools/find_previews.mjs` | 為每首歌搜尋 Apple Music 試聽，比對原聲帶專輯並避開翻唱、Karaoke、Demo 等版本 |
| `tools/build_songs.mjs` | 把搜尋結果與人工修正（`OVERRIDES`）合併進 `songs.js` |

## 新增題目

在 `songs.js` 的 `SONGS` 陣列**最後面**加一筆：

```js
{"zh":"中文片名","en":"English Title","track":"曲名","composer":"作曲者","year":2000,"type":"score","youtubeId":"影片ID"}
```

`type` 為 `score`（配樂）或 `song`（主題曲）。接著查詢 Apple Music 試聽並合併：

```powershell
node tools/find_previews.mjs
```

```powershell
node tools/build_songs.mjs
```

`find_previews.mjs` 會列出每首比對到的曲名／演出者／專輯，請人工確認是電影原聲帶或原唱版本；比對錯的（翻唱、Demo、Live、混音版等）把正確的 Apple trackId 寫進 `tools/build_songs.mjs` 的 `OVERRIDES` 再執行一次。iTunes API 每分鐘約 20 次請求上限，腳本會自動放慢。

---

試聽由 Apple Music 提供。音樂版權屬原權利人所有，本專案僅供娛樂與學習用途。
