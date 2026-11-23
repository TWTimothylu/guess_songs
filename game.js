/* 好萊塢配樂猜猜看 — 遊戲邏輯
 * 音樂透過 YouTube IFrame Player API 播放；作答期間影片被封面遮住，揭曉時才顯示。
 */
(() => {
  'use strict';

  const DIFFICULTY = {
    // hotIndex 對應 songs.js 中 hot 陣列：[5 秒, 10 秒, 15 秒]
    easy:   { snippet: 15, hotIndex: 2, startMin: 0.08, startMax: 0.15, answerTime: 30 },
    normal: { snippet: 10, hotIndex: 1, startMin: 0.10, startMax: 0.50, answerTime: 25 },
    hard:   { snippet: 5,  hotIndex: 0, startMin: 0.10, startMax: 0.75, answerTime: 20 },
  };
  const DIFF_LABEL = { easy: '簡單', normal: '普通', hard: '困難' };
  const LOAD_TIMEOUT_MS = 12000;
  const BEST_KEY = 'hollywood-guess-best';
  const NAME_KEY = 'hollywood-guess-name';
  const GAME_TITLE = '好萊塢配樂猜猜看';

  const $ = (id) => document.getElementById(id);
  const els = {
    start: $('btn-start'), best: $('best-score'),
    round: $('hud-round'), streak: $('hud-streak'), score: $('hud-score'),
    vinyl: $('vinyl'), labelDisc: $('label-disc'), status: $('cover-status'), ytLink: $('reveal-yt'),
    snippetFill: $('snippet-fill'), timerFill: $('timer-fill'),
    replay: $('btn-replay'), options: $('options'),
    reveal: $('reveal'), verdict: $('verdict'), revealTitle: $('reveal-title'), revealMeta: $('reveal-meta'),
    next: $('btn-next'),
    finalScore: $('final-score'), finalCorrect: $('final-correct'), finalStreak: $('final-streak'),
    rank: $('final-rank'), credits: $('credits'), again: $('btn-again'),
    settingsBox: $('settings'), challengeBanner: $('challenge-banner'), challengeText: $('challenge-text'),
    exitChallenge: $('btn-exit-challenge'), challengeResult: $('challenge-result'),
    name: $('player-name'), shareImgBtn: $('btn-share-img'), invite: $('btn-invite'),
    inviteMsg: $('invite-msg'), inviteLink: $('invite-link'),
    modal: $('share-modal'), closeShare: $('btn-close-share'), shareImg: $('share-img'),
    shareIg: $('btn-share-ig'), download: $('btn-download'), shareHint: $('share-hint'),
  };

  const settings = { difficulty: 'normal', rounds: 10, pool: 'all' };
  let player = null;
  let playerReady = false;
  let game = null;   // 本局狀態
  let round = null;  // 本題狀態
  let ticker = null;

  /* ---------- 工具 ---------- */
  const shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const rand = (min, max) => min + Math.random() * (max - min);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  const storage = {
    get(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } },
    set(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* 無痕模式等情況忽略 */ } },
  };

  function showScreen(name) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === `screen-${name}`));
    window.scrollTo({ top: 0 });
  }

  function renderBest() {
    const best = storage.get(BEST_KEY) || {};
    const b = best[settings.difficulty];
    els.best.textContent = b ? `${DIFF_LABEL[settings.difficulty]}模式最高分：${b}` : '';
  }

  /* ---------- 挑戰連結 ----------
   * 格式：?d=normal&q=3.17.45&s=1230&c=7&n=名字
   * q 是 SONGS 的索引（songs.js 只能往後新增，才不會讓舊連結對到別首歌）
   */
  function parseChallenge() {
    const p = new URLSearchParams(location.search);
    if (!p.has('q')) return null;
    const d = p.get('d');
    if (!DIFFICULTY[d]) return null;
    const q = p.get('q').split('.').map(Number);
    const valid = q.length >= 1 && q.length <= 20 && new Set(q).size === q.length &&
      q.every((i) => Number.isInteger(i) && i >= 0 && i < SONGS.length);
    if (!valid) return null;
    return {
      d,
      songs: q.map((i) => SONGS[i]),
      score: Math.max(0, parseInt(p.get('s'), 10) || 0),
      correct: clamp(parseInt(p.get('c'), 10) || 0, 0, q.length),
      name: (p.get('n') || '').trim().slice(0, 16),
    };
  }

  function buildInviteUrl() {
    const p = new URLSearchParams();
    p.set('d', settings.difficulty);
    p.set('q', game.history.map((h) => SONGS.indexOf(h.song)).join('.'));
    p.set('s', game.score);
    p.set('c', game.correct);
    const name = els.name.value.trim();
    if (name) p.set('n', name);
    return `${location.origin}${location.pathname}?${p}`;
  }

  let challenge = parseChallenge();

  function startLabel() {
    if (!playerReady) return;
    els.start.textContent = challenge ? '接受挑戰' : '開始遊戲';
  }

  function renderChallenge() {
    els.challengeBanner.hidden = !challenge;
    els.settingsBox.hidden = !!challenge;
    if (challenge) {
      settings.difficulty = challenge.d;
      const t = els.challengeText;
      t.textContent = '';
      const who = document.createElement('b');
      who.textContent = challenge.name || '你的朋友';
      const score = document.createElement('b');
      score.textContent = `${challenge.score} 分`;
      t.append(who, ' 邀請你挑戰！', document.createElement('br'),
        `在${DIFF_LABEL[challenge.d]}模式 ${challenge.songs.length} 題中拿下 `, score,
        `（答對 ${challenge.correct} 題）。用同一組題目比比看！`);
    }
    startLabel();
    renderBest();
  }

  function leaveChallenge() {
    challenge = null;
    history.replaceState(null, '', location.pathname);
    // 還原設定按鈕的選取狀態
    document.querySelectorAll('.seg').forEach((seg) => {
      const key = seg.dataset.setting;
      seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', String(settings[key]) === b.dataset.value));
    });
    renderChallenge();
  }

  /* ---------- 設定 ---------- */
  document.querySelectorAll('.seg').forEach((seg) => {
    seg.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === btn));
      const key = seg.dataset.setting;
      settings[key] = key === 'rounds' ? Number(btn.dataset.value) : btn.dataset.value;
      renderBest();
    });
  });
  renderChallenge();
  els.name.value = storage.get(NAME_KEY) || '';

  /* ---------- YouTube 播放器 ---------- */
  window.onYouTubeIframeAPIReady = () => {
    player = new YT.Player('yt-player', {
      width: '100%', height: '100%',
      playerVars: { controls: 0, disablekb: 1, playsinline: 1, rel: 0, iv_load_policy: 3, fs: 0, cc_load_policy: 0 },
      events: {
        onReady: () => {
          playerReady = true;
          // 影片永遠藏在封面下，也不讓鍵盤 Tab 進去
          const iframe = player.getIframe();
          iframe.tabIndex = -1;
          iframe.setAttribute('aria-hidden', 'true');
          els.start.disabled = false;
          startLabel();
        },
        onError: onPlayerError,
      },
    });
  };
  // 若 API 腳本載入失敗
  setTimeout(() => {
    if (!playerReady) els.start.textContent = '無法載入 YouTube 播放器，請重新整理';
  }, 15000);

  function onPlayerError() {
    // 影片無法播放（已刪除 / 禁止嵌入 / 地區限制）→ 換一首
    if (round && (round.phase === 'loading' || round.phase === 'seeking')) replaceSong();
  }

  /* ---------- 遊戲流程 ---------- */
  function newGame() {
    let queue, total;
    if (challenge) {
      // 挑戰模式：同一組題目、同樣順序；後面接備用歌，萬一有影片無法播放時遞補
      settings.difficulty = challenge.d;
      queue = [...challenge.songs, ...shuffle(SONGS.filter((s) => !challenge.songs.includes(s)))];
      total = challenge.songs.length;
    } else {
      queue = shuffle(SONGS.filter((s) => settings.pool === 'all' || s.type === settings.pool));
      total = Math.min(settings.rounds, queue.length);
    }
    game = {
      cfg: DIFFICULTY[settings.difficulty],
      total,
      queue,           // 尚未出題的歌
      index: 0,
      score: 0, streak: 0, bestStreak: 0, correct: 0,
      history: [],
    };
    showScreen('game');
    startRound();
  }

  function makeOptions(song) {
    const others = shuffle(SONGS.filter((s) => s.en !== song.en)).slice(0, 3);
    return shuffle([song, ...others]);
  }

  function startRound(song = game.queue.shift()) {
    if (!song) return endGame();
    round = {
      song,
      options: makeOptions(song),
      phase: 'loading',
      loadStartedAt: performance.now(),
      snippetStart: 0,
      snippetPlaying: false,
      answerStartedAt: 0,
      answered: false,
    };

    els.round.textContent = `${game.index + 1} / ${game.total}`;
    els.streak.textContent = game.streak;
    els.score.textContent = game.score;
    els.labelDisc.textContent = '?';
    els.vinyl.classList.remove('spin');
    els.status.textContent = '載入音樂中…';
    els.snippetFill.style.width = '0%';
    els.timerFill.style.transform = 'scaleX(1)';
    els.timerFill.classList.remove('warn');
    els.replay.disabled = true;
    els.reveal.hidden = true;
    renderOptions(true);

    player.mute();
    player.loadVideoById({ videoId: song.youtubeId });
    startTicker();
  }

  function replaceSong() {
    const next = game.queue.shift();
    if (!next) {
      // 題庫用完了，提早結束
      game.total = game.index;
      return endGame();
    }
    startRound(next);
  }

  function renderOptions(disabled) {
    els.options.innerHTML = '';
    round.options.forEach((opt, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'option';
      b.disabled = disabled;
      b.dataset.en = opt.en;
      b.innerHTML = `<span class="key">${i + 1}</span><span class="zh"></span><span class="en"></span>`;
      b.querySelector('.zh').textContent = opt.zh;
      b.querySelector('.en').textContent = `${opt.en}（${opt.year}）`;
      b.addEventListener('click', () => answer(opt));
      els.options.appendChild(b);
    });
  }

  function startTicker() {
    clearInterval(ticker);
    ticker = setInterval(tick, 100);
  }

  function tick() {
    if (!round || !player) return;
    const state = player.getPlayerState();
    const now = performance.now();

    if (round.phase === 'loading') {
      if (state === YT.PlayerState.PLAYING) {
        // 影片開始了（靜音），決定片段起點後跳過去
        const dur = player.getDuration() || 0;
        const { snippet, startMin, startMax, hotIndex } = game.cfg;
        const hot = round.song.hot && round.song.hot[hotIndex];
        let start = 0;
        if (typeof hot === 'number') {
          // 使用 YouTube「重播次數最多」熱度最高的段落
          start = dur ? clamp(hot, 0, Math.max(0, dur - snippet - 1)) : hot;
        } else if (dur > snippet + 6) {
          // 沒有熱度資料的影片：退回隨機段落
          start = rand(dur * startMin, dur * startMax);
          start = clamp(start, 3, dur - snippet - 3);
        }
        round.snippetStart = start;
        round.phase = 'seeking';
        try { player.unloadModule('captions'); } catch { /* 沒有字幕模組時忽略 */ }
        player.seekTo(start, true);
      } else if (now - round.loadStartedAt > LOAD_TIMEOUT_MS) {
        replaceSong();
      }
      return;
    }

    if (round.phase === 'seeking') {
      const t = player.getCurrentTime();
      if (state === YT.PlayerState.PLAYING && Math.abs(t - round.snippetStart) < 1.5) {
        round.snippetStart = t;
        player.unMute();
        player.setVolume(100);
        round.phase = 'answering';
        round.snippetPlaying = true;
        round.answerStartedAt = now;
        els.vinyl.classList.add('spin');
        els.status.textContent = '仔細聽…';
        els.replay.disabled = false;
        renderOptions(false);
      } else if (now - round.loadStartedAt > LOAD_TIMEOUT_MS) {
        replaceSong();
      }
      return;
    }

    if (round.phase === 'answering') {
      // 片段進度
      if (round.snippetPlaying) {
        const elapsed = player.getCurrentTime() - round.snippetStart;
        const ratio = clamp(elapsed / game.cfg.snippet, 0, 1);
        els.snippetFill.style.width = `${ratio * 100}%`;
        if (ratio >= 1) {
          player.pauseVideo();
          round.snippetPlaying = false;
          els.vinyl.classList.remove('spin');
          els.status.textContent = '片段結束，可以再聽一次';
        }
      }
      // 作答倒數
      const left = 1 - (now - round.answerStartedAt) / (game.cfg.answerTime * 1000);
      els.timerFill.style.transform = `scaleX(${clamp(left, 0, 1)})`;
      els.timerFill.classList.toggle('warn', left < 0.3);
      if (left <= 0) answer(null);
    }
  }

  function replay() {
    if (!round || round.phase !== 'answering') return;
    player.seekTo(round.snippetStart, true);
    player.playVideo();
    round.snippetPlaying = true;
    els.vinyl.classList.add('spin');
    els.status.textContent = '仔細聽…';
  }

  function answer(choice) {
    if (!round || round.phase !== 'answering') return;
    round.phase = 'revealed';
    const song = round.song;
    const ok = choice && choice.en === song.en;
    const left = clamp(1 - (performance.now() - round.answerStartedAt) / (game.cfg.answerTime * 1000), 0, 1);

    let gained = 0;
    if (ok) {
      game.streak += 1;
      game.correct += 1;
      game.bestStreak = Math.max(game.bestStreak, game.streak);
      gained = 100 + Math.round(100 * left) + 20 * Math.min(game.streak - 1, 5);
      game.score += gained;
    } else {
      game.streak = 0;
    }
    game.history.push({ song, ok, gained });

    // 選項標示
    els.options.querySelectorAll('.option').forEach((b) => {
      b.disabled = true;
      if (b.dataset.en === song.en) b.classList.add('correct');
      else if (choice && b.dataset.en === choice.en) b.classList.add('wrong');
      else b.classList.add('dim');
    });

    // 揭曉：影片始終被封面遮住，只從片段起點繼續播放聲音
    els.replay.disabled = true;
    els.labelDisc.textContent = ok ? '✓' : '✗';
    els.vinyl.classList.add('spin');
    els.status.textContent = '♪ 繼續欣賞這首曲子';
    els.snippetFill.style.width = '100%';
    player.seekTo(round.snippetStart, true);
    player.playVideo();
    els.ytLink.href = `https://www.youtube.com/watch?v=${song.youtubeId}`;

    els.verdict.className = `verdict ${ok ? 'ok' : 'no'}`;
    els.verdict.textContent = ok
      ? `答對了！+${gained}${game.streak > 1 ? `（${game.streak} 連擊）` : ''}`
      : choice ? '答錯了！' : '時間到！';
    els.revealTitle.textContent = `《${song.zh}》${song.en}（${song.year}）`;
    els.revealMeta.textContent = `${song.track} — ${song.composer}`;
    els.next.textContent = game.index + 1 >= game.total ? '看結果 →' : '下一題 →';
    els.reveal.hidden = false;
    els.streak.textContent = game.streak;
    els.score.textContent = game.score;
    els.next.focus({ preventScroll: true });
  }

  function nextRound() {
    if (!round || round.phase !== 'revealed') return;
    game.index += 1;
    if (game.index >= game.total) return endGame();
    startRound();
  }

  function endGame() {
    clearInterval(ticker);
    if (player && playerReady) player.stopVideo();
    round = null;

    const total = game.history.length;
    els.finalScore.textContent = game.score;
    els.finalCorrect.textContent = `${game.correct} / ${total}`;
    els.finalStreak.textContent = game.bestStreak;

    const rate = total ? game.correct / total : 0;
    els.rank.textContent =
      rate === 1 ? '🏆 奧斯卡最佳配樂評審等級！' :
      rate >= 0.8 ? '🎬 資深影迷' :
      rate >= 0.5 ? '🍿 週末電影院常客' :
      rate >= 0.2 ? '📼 偶爾看看片' : '🎟️ 下次多進幾趟電影院吧';

    els.credits.innerHTML = '';
    game.history.forEach(({ song, ok, gained }) => {
      const li = document.createElement('li');
      li.innerHTML = `<span class="mark ${ok ? 'ok' : 'no'}">${ok ? '✓' : '✗'}</span>
        <span><b></b><small></small></span><a target="_blank" rel="noopener">YouTube ↗</a>`;
      li.querySelector('b').textContent = `《${song.zh}》${ok ? ` +${gained}` : ''}`;
      li.querySelector('small').textContent = `${song.track} — ${song.composer}`;
      li.querySelector('a').href = `https://www.youtube.com/watch?v=${song.youtubeId}`;
      els.credits.appendChild(li);
    });

    const best = storage.get(BEST_KEY) || {};
    if (!best[settings.difficulty] || game.score > best[settings.difficulty]) {
      best[settings.difficulty] = game.score;
      storage.set(BEST_KEY, best);
      if (game.score > 0) els.rank.textContent += '　✨ 新紀錄！';
    }

    // 挑戰結果
    els.challengeResult.hidden = !challenge;
    if (challenge) {
      const rival = challenge.name || '朋友';
      const diff = game.score - challenge.score;
      els.challengeResult.textContent =
        diff > 0 ? `🎉 你贏了 ${rival}！（${game.score} vs ${challenge.score}）` :
        diff < 0 ? `😤 差 ${-diff} 分輸給 ${rival}（${game.score} vs ${challenge.score}）` :
        `🤝 和 ${rival} 平手！（${game.score} 分）`;
    }

    els.inviteMsg.textContent = '';
    els.inviteLink.hidden = true;
    showScreen('end');
  }

  /* ---------- 分享成績圖 ---------- */
  let shareBlob = null;
  let shareUrl = null;

  function shareFileName() {
    return `hollywood-score-${game.score}.png`;
  }

  async function openShare() {
    if (!game) return;
    storage.set(NAME_KEY, els.name.value.trim());
    els.modal.hidden = false;
    els.shareImg.removeAttribute('src');
    els.shareIg.disabled = true;
    els.download.disabled = true;
    els.shareHint.textContent = '產生圖片中…';
    try {
      shareBlob = await window.ShareImage.drawScoreImage({
        name: els.name.value.trim(),
        score: game.score,
        correct: game.correct,
        total: game.history.length,
        bestStreak: game.bestStreak,
        difficultyLabel: DIFF_LABEL[settings.difficulty],
        rank: els.rank.textContent.replace('　✨ 新紀錄！', ''),
        history: game.history,
        inviteUrl: buildInviteUrl(),
        displayUrl: (location.host + location.pathname).replace(/\/$/, ''),
      });
    } catch {
      els.shareHint.textContent = '圖片產生失敗，請再試一次。';
      return;
    }
    if (shareUrl) URL.revokeObjectURL(shareUrl);
    shareUrl = URL.createObjectURL(shareBlob);
    els.shareImg.src = shareUrl;

    const file = new File([shareBlob], shareFileName(), { type: 'image/png' });
    const canShareFile = !!(navigator.canShare && navigator.canShare({ files: [file] }));
    els.shareIg.hidden = !canShareFile;
    els.shareIg.disabled = false;
    els.download.disabled = false;
    els.shareHint.textContent = canShareFile
      ? '點「分享到 IG」後選 Instagram → 限時動態；也可以先下載圖片。'
      : '下載圖片後，到 IG 新增限時動態並選擇這張圖片即可分享。';
  }

  function closeShare() {
    els.modal.hidden = true;
  }

  function downloadImage() {
    if (!shareUrl) return;
    const a = document.createElement('a');
    a.href = shareUrl;
    a.download = shareFileName();
    document.body.appendChild(a);
    a.click();
    a.remove();
    els.shareHint.textContent = '已下載！到 IG 新增限時動態並選擇這張圖片即可分享。';
  }

  async function shareToIg() {
    if (!shareBlob) return;
    const file = new File([shareBlob], shareFileName(), { type: 'image/png' });
    try {
      await navigator.share({ files: [file] });
    } catch (e) {
      if (e && e.name === 'AbortError') return; // 使用者取消
      downloadImage();
    }
  }

  /* ---------- 邀請朋友 ---------- */
  async function invite() {
    if (!game) return;
    const name = els.name.value.trim();
    storage.set(NAME_KEY, name);
    const url = buildInviteUrl();
    const text = `${name || '我'}在「${GAME_TITLE}」${DIFF_LABEL[settings.difficulty]}模式拿了 ${game.score} 分（答對 ${game.correct}/${game.history.length}），用同一組題目來挑戰看看，你能贏過我嗎？🎬`;

    els.inviteLink.value = url;
    els.inviteLink.hidden = false;

    if (navigator.share) {
      try {
        await navigator.share({ title: GAME_TITLE, text, url });
        els.inviteMsg.textContent = '已送出邀請！';
        return;
      } catch (e) {
        if (e && e.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(`${text}\n${url}`);
      els.inviteMsg.textContent = '✅ 已複製邀請訊息和連結，貼給朋友吧！';
    } catch {
      els.inviteMsg.textContent = '請複製下面的連結傳給朋友：';
      els.inviteLink.select();
    }
  }

  /* ---------- 事件 ---------- */
  els.start.addEventListener('click', () => { if (playerReady) newGame(); });
  els.again.addEventListener('click', () => {
    if (challenge) leaveChallenge(); else renderBest();
    showScreen('start');
  });
  els.exitChallenge.addEventListener('click', leaveChallenge);
  els.shareImgBtn.addEventListener('click', openShare);
  els.closeShare.addEventListener('click', closeShare);
  els.modal.addEventListener('click', (e) => { if (e.target === els.modal) closeShare(); });
  els.download.addEventListener('click', downloadImage);
  els.shareIg.addEventListener('click', shareToIg);
  els.invite.addEventListener('click', invite);
  els.inviteLink.addEventListener('focus', () => els.inviteLink.select());
  els.name.addEventListener('change', () => storage.set(NAME_KEY, els.name.value.trim()));
  els.replay.addEventListener('click', replay);
  els.next.addEventListener('click', nextRound);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !els.modal.hidden) return closeShare();
    if (!round) return;
    if (round.phase === 'answering' && /^[1-4]$/.test(e.key)) {
      answer(round.options[Number(e.key) - 1]);
    } else if (round.phase === 'answering' && (e.key === 'r' || e.key === 'R')) {
      replay();
    } else if (round.phase === 'revealed' && e.key === 'Enter' && document.activeElement !== els.next) {
      nextRound();
    }
  });
})();
