/* 好萊塢配樂猜猜看 — 遊戲邏輯
 * 音樂透過 YouTube IFrame Player API 播放；作答期間影片被封面遮住，揭曉時才顯示。
 */
(() => {
  'use strict';

  const DIFFICULTY = {
    easy:   { snippet: 15, startMin: 0.08, startMax: 0.15, answerTime: 30 },
    normal: { snippet: 10, startMin: 0.10, startMax: 0.50, answerTime: 25 },
    hard:   { snippet: 5,  startMin: 0.10, startMax: 0.75, answerTime: 20 },
  };
  const LOAD_TIMEOUT_MS = 12000;
  const BEST_KEY = 'hollywood-guess-best';

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
    const label = { easy: '簡單', normal: '普通', hard: '困難' }[settings.difficulty];
    const b = best[settings.difficulty];
    els.best.textContent = b ? `${label}模式最高分：${b}` : '';
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
  renderBest();

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
          els.start.textContent = '開始遊戲';
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
    const pool = SONGS.filter((s) => settings.pool === 'all' || s.type === settings.pool);
    const queue = shuffle(pool);
    game = {
      cfg: DIFFICULTY[settings.difficulty],
      total: Math.min(settings.rounds, queue.length),
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
        const { snippet, startMin, startMax } = game.cfg;
        let start = 0;
        if (dur > snippet + 6) {
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
    showScreen('end');
  }

  /* ---------- 事件 ---------- */
  els.start.addEventListener('click', () => { if (playerReady) newGame(); });
  els.again.addEventListener('click', () => { renderBest(); showScreen('start'); });
  els.replay.addEventListener('click', replay);
  els.next.addEventListener('click', nextRound);

  document.addEventListener('keydown', (e) => {
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
