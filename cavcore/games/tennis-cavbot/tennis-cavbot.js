/* ==========================================================
  Control Room Tennis · CavBot (REAL ARCADE + 6 LEVEL CYCLE)
========================================================== */
(function(){
  'use strict';

  function randomFrom(arr){
    if(!arr || !arr.length) return '';
    return arr[Math.floor(Math.random() * arr.length)];
  }

  if(!window.cavbotBrain || !window.cavbotBrain._internal){
    return;
  }

  var analytics = window.cavbotBrain._internal.analytics;
  var session = window.cavbotBrain._internal.session;
  var persistAnalytics = window.cavbotBrain._internal.persistAnalytics;
  var trackEvent = window.cavbotBrain._internal.trackEvent;

  // Tennis analytics fields (persisted inside CavBot analytics object)
  analytics.tennisMatches = analytics.tennisMatches || 0;
  analytics.tennisWins = analytics.tennisWins || 0;
  analytics.tennisLosses = analytics.tennisLosses || 0;
  analytics.tennisBestRally = analytics.tennisBestRally || 0;
  analytics.tennisFastestWinMs = analytics.tennisFastestWinMs || null;
  analytics.tennisLifetimePoints = analytics.tennisLifetimePoints || 0;

  // DOM
  var court = document.getElementById('tennis-court');
  var paddlePlayer = document.getElementById('paddle-player');
  var paddleBot = document.getElementById('paddle-bot');
  var ballEl = document.getElementById('ball');

  var scoreYouEl = document.getElementById('score-you');
  var scoreBotEl = document.getElementById('score-bot');

  var statMatchEl = document.getElementById('stat-match');
  var statTimerEl = document.getElementById('stat-timer');
  var statBestRallyEl = document.getElementById('stat-best-rally');
  var statDifficultyEl = document.getElementById('stat-difficulty');
  var statRecordEl = document.getElementById('stat-record');

  var gameLogInner = document.getElementById('game-log-inner');
  var chatLogInner = document.getElementById('chat-log-inner'); // restored

  var dmLineEl = document.getElementById('cavbot-dm-line');
  var dmCursorEl = document.getElementById('cavbot-dm-cursor');
  var dmSegments = dmLineEl ? Array.prototype.slice.call(dmLineEl.querySelectorAll('.cavbot-dm-segment')) : [];

  var btnReset = document.getElementById('btn-reset');
  var btnSound = document.getElementById('btn-sound');
  var soundStateEl = document.getElementById('sound-state');

  if(!court || !paddlePlayer || !paddleBot || !ballEl) return;

  /* ==========================================================
    LEVEL SYSTEM (6 levels, each VISIT advances, loops 1..6)
    - Uses localStorage so it persists across visits
    - If storage is blocked, falls back to sessionStorage
  ========================================================== */
  var LEVEL_KEY = 'cavbot_tennis_level_cycle_v1';

  function safeGetStorage(){
    try{ return window.localStorage; }catch(e){}
    try{ return window.sessionStorage; }catch(e){}
    return null;
  }

  function getVisitLevel(){
    var store = safeGetStorage();
    if(!store) return 1;

    var raw = store.getItem(LEVEL_KEY);
    var prev = parseInt(raw || '0', 10);
    if(!isFinite(prev) || prev < 0) prev = 0;

    var next = (prev % 6) + 1; // 1..6 loop
    store.setItem(LEVEL_KEY, String(next));
    return next;
  }

  // 6 curated levels (hardness ramps cleanly; 6 is brutal)
  // Values are tuned for consistent feel across devices.
  var LEVELS = [
    { n:1, name:'Rookie',        factor:0.92, aiGain:6.5, aiMax:560, predict:0.58, lockChance:0.020, servePx:560,  accel:1.015 },
    { n:2, name:'Contender',     factor:1.00, aiGain:7.4, aiMax:640, predict:0.66, lockChance:0.018, servePx:610,  accel:1.017 },
    { n:3, name:'Operator',      factor:1.10, aiGain:8.4, aiMax:740, predict:0.74, lockChance:0.016, servePx:680,  accel:1.019 },
    { n:4, name:'Hardline',      factor:1.22, aiGain:9.6, aiMax:860, predict:0.82, lockChance:0.014, servePx:760,  accel:1.021 },
    { n:5, name:'Elite',         factor:1.36, aiGain:11.0,aiMax:980, predict:0.90, lockChance:0.012, servePx:860,  accel:1.023 },
    { n:6, name:'Nightmare',     factor:1.52, aiGain:12.6,aiMax:1140,predict:1.00, lockChance:0.010, servePx:980,  accel:1.026 }
  ];

  function levelSpec(n){
    var i = clamp((n|0) - 1, 0, 5);
    return LEVELS[i];
  }

  /* ---------------------------
    Restore Route (same pattern)
  --------------------------- */
  function getRestoreUrl(){
    try{
      var q = new URLSearchParams(window.location.search);
      var fromQuery = q.get('to') || q.get('restore') || q.get('r');
      if(fromQuery) return fromQuery;

      var fromSession = null;
      try{ fromSession = window.sessionStorage.getItem('cavbot_restore_route'); }catch(e){}
      if(fromSession) return fromSession;

      var ref = document.referrer || '';
      if(ref){
        var u = new URL(ref, window.location.origin);
        if(u.origin === window.location.origin) return u.pathname + u.search + u.hash;
      }
    }catch(e){}
    return '/';
  }

  var RESTORE_URL = getRestoreUrl();
  var restoreScheduled = false;

  function scheduleRestoreRedirect(reason){
    if(restoreScheduled) return;
    restoreScheduled = true;

    logGame('ROUTE · RESTORE · armed · redirecting shortly', 'ok');
    trackEvent('cavbot_tennis_route_restore', { reason: reason || 'scored_once', to: RESTORE_URL, level: state.level });

    setTimeout(function(){
      try{ window.location.assign(RESTORE_URL); }catch(e){ window.location.href = RESTORE_URL; }
    }, 1200);
  }

  /* ---------------------------
    Logging
  --------------------------- */
  function scrollToBottom(el){ if(el) el.scrollTop = el.scrollHeight; }

  function appendLog(inner, text, level, tsOverride){
    if(!inner) return;

    var line = document.createElement('div');
    line.className = 'log-line';

    var prefix = document.createElement('span');
    prefix.className = 'log-line-prefix';

    var tag = document.createElement('span');
    if(level === 'error'){ prefix.textContent='[ERR] '; tag.className='log-line-error'; }
    else if(level === 'warn'){ prefix.textContent='[WARN] '; tag.className='log-line-warning'; }
    else if(level === 'ok'){ prefix.textContent='[OK] '; tag.className='log-line-ok'; }
    else { prefix.textContent='[SYS] '; tag.className='log-line-tag'; }

    var ts = tsOverride || new Date().toLocaleTimeString('en-US',{hour12:false});
    var tsSpan = document.createElement('span');
    tsSpan.textContent = ' ' + ts + ' · ';

    tag.textContent = text;

    line.appendChild(prefix);
    line.appendChild(tsSpan);
    line.appendChild(tag);
    inner.appendChild(line);

    while(inner.children.length > 160){
      inner.removeChild(inner.firstChild);
    }
    scrollToBottom(inner);
  }

  function logGame(text, level){ appendLog(gameLogInner, text, level); }
  function logChat(text, level, tsOverride){ appendLog(chatLogInner, text, level, tsOverride); }

  /* ==========================================================
    SOUND + ORIGINAL OST (“Neon Serve”)
  ========================================================== */
  var soundEnabled = false;
  var audioCtx = null;
  var masterGain = null;

  var music = {
    running: false,
    tempo: 124,
    step: 0,
    nextTime: 0,
    timer: null,
    lookahead: 25,
    scheduleAhead: 0.12,
    noiseBuf: null
  };

  function ensureAudio(){
    if(audioCtx) return true;
    try{
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();

      masterGain = audioCtx.createGain();
      masterGain.gain.value = 0.22;
      masterGain.connect(audioCtx.destination);

      // noise buffer (hats/snare)
      var len = audioCtx.sampleRate * 1.0;
      var buffer = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
      var data = buffer.getChannelData(0);
      for(var i=0;i<len;i++){
        data[i] = (Math.random() * 2 - 1) * 0.8;
      }
      music.noiseBuf = buffer;

      return true;
    }catch(e){
      return false;
    }
  }

  function resumeAudioIfNeeded(){
    if(!ensureAudio()) return;
    if(audioCtx.state === 'suspended'){
      audioCtx.resume().catch(function(){});
    }
  }

  function midiToFreq(m){ return 440 * Math.pow(2, (m - 69)/12); }

  function tone(opts){
    if(!soundEnabled) return;
    resumeAudioIfNeeded();

    var t = opts.time || audioCtx.currentTime;
    var dur = opts.dur || 0.12;
    var type = opts.type || 'square';
    var freq = opts.freq || 440;
    var vol = (typeof opts.vol === 'number') ? opts.vol : 0.06;

    var o = audioCtx.createOscillator();
    var g = audioCtx.createGain();

    o.type = type;
    o.frequency.setValueAtTime(freq, t);

    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    o.connect(g);
    g.connect(masterGain);

    o.start(t);
    o.stop(t + dur + 0.02);
  }

  function noiseHit(opts){
    if(!soundEnabled) return;
    resumeAudioIfNeeded();

    var t = opts.time || audioCtx.currentTime;
    var dur = opts.dur || 0.04;
    var vol = (typeof opts.vol === 'number') ? opts.vol : 0.06;
    var hp = (typeof opts.hp === 'number') ? opts.hp : 6000;

    var src = audioCtx.createBufferSource();
    src.buffer = music.noiseBuf;

    var filter = audioCtx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(hp, t);

    var g = audioCtx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    src.connect(filter);
    filter.connect(g);
    g.connect(masterGain);

    src.start(t);
    src.stop(t + dur + 0.02);
  }

  function startMusic(){
    if(music.running) return;
    if(!ensureAudio()) return;

    resumeAudioIfNeeded();
    music.running = true;
    music.step = 0;
    music.nextTime = audioCtx.currentTime + 0.06;

    if(music.timer) clearInterval(music.timer);
    music.timer = setInterval(musicScheduler, music.lookahead);
  }

  function stopMusic(){
    music.running = false;
    if(music.timer){
      clearInterval(music.timer);
      music.timer = null;
    }
  }

  function musicScheduler(){
    if(!music.running || !soundEnabled) return;

    var secondsPerBeat = 60.0 / music.tempo;
    var secondsPerStep = secondsPerBeat / 4;

    while(music.nextTime < audioCtx.currentTime + music.scheduleAhead){
      scheduleMusicStep(music.step, music.nextTime);
      music.nextTime += secondsPerStep;
      music.step = (music.step + 1) % 64;
    }
  }

  function scheduleMusicStep(step, t){
    var lead = [
      74,null,76,null, 79,null,76,null, 74,null,72,null, 71,null,72,null,
      74,null,76,null, 81,null,79,null, 76,null,74,null, 72,null,71,null,
      74,null,76,null, 79,null,76,null, 74,null,72,null, 71,null,72,null,
      81,null,79,null, 76,null,74,null, 72,null,71,null, 69,null,71,null
    ];

    var arp = [
      86,93,89,93, 86,93,89,93, 84,91,88,91, 83,90,86,90,
      86,93,89,93, 88,95,91,95, 89,96,93,96, 86,93,89,93,
      86,93,89,93, 86,93,89,93, 84,91,88,91, 83,90,86,90,
      88,95,91,95, 89,96,93,96, 86,93,89,93, 84,91,88,91
    ];

    var bass = [
      38,null,null,null, 38,null,41,null, 43,null,null,null, 41,null,38,null,
      38,null,null,null, 45,null,43,null, 41,null,null,null, 38,null,36,null,
      38,null,null,null, 38,null,41,null, 43,null,null,null, 41,null,38,null,
      45,null,null,null, 43,null,41,null, 38,null,null,null, 36,null,35,null
    ];

    var isKick = (step % 16 === 0) || (step % 16 === 8);
    var isHat  = (step % 4 === 2);

    if(isKick){
      tone({ time:t, freq: 130, type:'sine', dur:0.06, vol:0.08 });
      tone({ time:t+0.01, freq: 65, type:'sine', dur:0.07, vol:0.06 });
    }
    if(isHat){
      noiseHit({ time:t, dur:0.03, vol:0.05, hp:7800 });
    }
    if(step % 16 === 4 || step % 16 === 12){
      noiseHit({ time:t, dur:0.055, vol:0.06, hp:3000 });
      tone({ time:t, freq: 240, type:'triangle', dur:0.05, vol:0.03 });
    }

    var ln = lead[step];
    if(ln){
      tone({ time:t, freq: midiToFreq(ln), type:'square', dur:0.11, vol:0.053 });
    }

    if(step % 2 === 0){
      var an = arp[step];
      if(an){
        tone({ time:t, freq: midiToFreq(an), type:'sawtooth', dur:0.07, vol:0.022 });
      }
    }

    var bn = bass[step];
    if(bn){
      tone({ time:t, freq: midiToFreq(bn), type:'triangle', dur:0.14, vol:0.05 });
    }
  }

  function blip(freq, durMs, type, gain){
    if(!soundEnabled) return;
    if(!ensureAudio()) return;
    resumeAudioIfNeeded();

    var t = audioCtx.currentTime;
    tone({
      time: t,
      freq: freq,
      type: type || 'sine',
      dur: Math.max(0.02, durMs/1000),
      vol: (typeof gain === 'number') ? gain : 0.06
    });
  }

  function hitSfx(){
    blip(740, 35, 'square', 0.04);
    setTimeout(function(){ blip(980, 45, 'square', 0.035); }, 28);
  }
  function pointSfx(){
    blip(392, 95, 'sawtooth', 0.045);
    setTimeout(function(){ blip(523, 120, 'sawtooth', 0.045); }, 90);
  }
  function winSfx(){
    blip(523, 120, 'triangle', 0.05);
    setTimeout(function(){ blip(659, 160, 'triangle', 0.05); }, 120);
    setTimeout(function(){ blip(784, 190, 'triangle', 0.045); }, 260);
  }

  function setSoundUI(){
    if(soundStateEl) soundStateEl.textContent = soundEnabled ? 'ON' : 'OFF';
  }

  if(btnSound){
    btnSound.addEventListener('click', function(){
      soundEnabled = !soundEnabled;
      setSoundUI();

      if(soundEnabled){
        ensureAudio();
        resumeAudioIfNeeded();
        startMusic();
        blip(880, 55, 'square', 0.04);
        logGame('SOUND · enabled (Neon Serve OST online)', 'ok');
      }else{
        stopMusic();
        logGame('SOUND · disabled', 'warn');
      }

      trackEvent('cavbot_tennis_sound_toggle', { enabled: soundEnabled, level: state.level });
    });
  }

  /* ---------------------------
    Game state
  --------------------------- */
  var state = {
    // visit-based level
    level: getVisitLevel(),
    levelName: 'Rookie',

    match: analytics.tennisMatches + 1,
    matchStart: null,
    running: false,
    armed: false,
    raf: null,

    // fixed timestep
    lastFrameTs: 0,
    acc: 0,

    w: 0, h: 0,

    paddleH: 86,
    paddleW: 14,

    // positions (top-left for transforms)
    playerX: 0, playerY: 0,
    botX: 0, botY: 0,
    bx: 0, by: 0,

    // velocity (px/s for real-time sim)
    bvx: 0, bvy: 0,
    serveSpeed: 620,
    maxBallSpeed: 1200,

    // score
    you: 0,
    bot: 0,
    targetScore: 5,

    // rally
    rally: 0,
    bestRallyThisMatch: 0,

    // input
    pointerY: null,
    playerVel: 0,
    lastPlayerY: null,
    lastInputTs: performance.now(),

    // AI (level-scaled)
    aiLock: 0,
    aiGain: 7.4,        // proportional gain (1/s)
    aiMaxSpeed: 680,    // px/s
    aiPredict: 0.70,    // prediction scalar
    aiLockChance: 0.016,

    // restore requirement
    scoredOnce: false
  };

  function clamp(v, min, max){ return v < min ? min : (v > max ? max : v); }

  /* ---------------------------
    Render
  --------------------------- */
  function render(){
    paddlePlayer.style.transform = 'translate(' + state.playerX.toFixed(2) + 'px,' + state.playerY.toFixed(2) + 'px)';
    paddleBot.style.transform = 'translate(' + state.botX.toFixed(2) + 'px,' + state.botY.toFixed(2) + 'px)';
    ballEl.style.transform = 'translate(' + state.bx.toFixed(2) + 'px,' + state.by.toFixed(2) + 'px)';

    if(scoreYouEl) scoreYouEl.textContent = String(state.you);
    if(scoreBotEl) scoreBotEl.textContent = String(state.bot);

    if(statMatchEl){
      var n = state.match < 10 ? ('0' + state.match) : String(state.match);
      statMatchEl.textContent = n;
    }
    if(statTimerEl){
      var s = (state.matchStart && state.running) ? ((performance.now() - state.matchStart) / 1000) : 0;
      statTimerEl.textContent = s.toFixed(2) + 's';
    }
    if(statBestRallyEl){
      statBestRallyEl.textContent = String(Math.max(analytics.tennisBestRally || 0, state.bestRallyThisMatch || 0));
    }
    if(statRecordEl){
      statRecordEl.textContent = (analytics.tennisWins||0) + 'W · ' + (analytics.tennisLosses||0) + 'L';
    }
    if(statDifficultyEl){
      // Uses your existing slot but now shows LEVEL (no HTML change)
      var lv = 'L' + state.level;
      statDifficultyEl.textContent = lv + ' · ' + state.levelName;
    }
  }

  /* ---------------------------
    Idle “thumbnail stance”
  --------------------------- */
  function setIdlePositions(){
    // restore CSS transitions in idle stance
    paddlePlayer.style.transition = '';
    paddleBot.style.transition = '';

    var gap = 18;
    var centerX = (state.w / 2) - (state.paddleW / 2);

    state.playerX = centerX - gap;
    state.botX = centerX + gap;

    state.playerY = (state.h / 2) - (state.paddleH / 2);
    state.botY = (state.h / 2) - (state.paddleH / 2);

    state.bx = (state.w / 2) - 8;
    state.by = (state.h / 2) - 8;

    state.bvx = 0;
    state.bvy = 0;

    render();
  }

  function resize(){
    var r = court.getBoundingClientRect();
    state.w = r.width;
    state.h = r.height;

    state.playerY = clamp(state.playerY, 12, state.h - state.paddleH - 12);
    state.botY = clamp(state.botY, 12, state.h - state.paddleH - 12);

    if(!state.running){
      setIdlePositions();
      return;
    }

    // keep paddle X on sides while running
    state.playerX = 16;
    state.botX = state.w - 16 - state.paddleW;

    render();
  }
  window.addEventListener('resize', resize);

  /* ---------------------------
    Input (same behavior)
  --------------------------- */
  function noteInput(){ state.lastInputTs = performance.now(); }

  function armServe(){
    if(state.armed) return;
    state.armed = true;
    logGame('SERVE · armed (move to start)', 'ok');
    trackEvent('cavbot_tennis_armed', { armed: true, level: state.level });
  }

  function ensureStarted(){
    if(state.running || restoreScheduled) return;
    if(!state.armed) return;
    startMatch(false);
  }

  function setPlayerFromPointer(clientY){
    var r = court.getBoundingClientRect();
    var y = clientY - r.top - (state.paddleH / 2);
    y = clamp(y, 12, state.h - state.paddleH - 12);

    if(state.lastPlayerY == null) state.lastPlayerY = y;
    state.playerVel = y - state.lastPlayerY;
    state.lastPlayerY = y;

    state.playerY = y;

    noteInput();
    ensureStarted();
  }

  court.addEventListener('mouseenter', function(){ armServe(); });

  court.addEventListener('mousemove', function(e){
    armServe();
    state.pointerY = e.clientY;
    setPlayerFromPointer(e.clientY);
  });

  court.addEventListener('touchstart', function(e){
    armServe();
    var t = e.touches && e.touches[0];
    if(!t) return;
    state.pointerY = t.clientY;
    setPlayerFromPointer(t.clientY);
  }, {passive:true});

  court.addEventListener('touchmove', function(e){
    var t = e.touches && e.touches[0];
    if(!t) return;
    state.pointerY = t.clientY;
    setPlayerFromPointer(t.clientY);
  }, {passive:true});

  window.addEventListener('keydown', function(e){
    if(e.key === 'r' || e.key === 'R'){
      state.armed = true;
      startMatch(true);
    }
  });

  /* ==========================================================
    LEVEL SEEDING (replaces win-rate tiering)
  ========================================================== */
  function seedDifficulty(){
    var spec = levelSpec(state.level);
    state.levelName = spec.name;

    state.aiGain = spec.aiGain;
    state.aiMaxSpeed = spec.aiMax;
    state.aiPredict = spec.predict;
    state.aiLockChance = spec.lockChance;

    state.serveSpeed = spec.servePx;
    state.maxBallSpeed = Math.max(980, Math.floor(spec.servePx * 1.55));
  }

  function resetPositions(servingTo){
    state.playerX = 16;
    state.botX = state.w - 16 - state.paddleW;

    state.playerY = clamp(state.playerY, 12, state.h - state.paddleH - 12);
    state.botY = (state.h / 2) - (state.paddleH / 2);

    state.bx = (state.w / 2) - 8;
    state.by = (state.h / 2) - 8;

    var dir = (servingTo === 'bot') ? 1 : -1;

    // Serve angle: keeps it playable but varied
    var angle = (Math.random() * 0.88 - 0.44);
    var sp = state.serveSpeed;

    state.bvx = dir * (sp * (0.95 + Math.random() * 0.10));
    state.bvy = angle * (sp * (0.55 + Math.random() * 0.25));

    state.rally = 0;
    render();
  }

  /* ---------------------------
    AI + physics (REAL-TIME)
  --------------------------- */
  function updateAI(dt){
    if(state.aiLock > 0){
      state.aiLock -= 1;
      return;
    }

    // Target the ball center, with prediction when ball is moving toward bot
    var targetY = (state.by + 8) - (state.paddleH / 2);

    if(state.bvx > 0){
      // prediction scales with level (aiPredict 0.58..1.00)
      targetY += (state.bvy * 0.18) * state.aiPredict; // px/s -> lookahead scalar
      targetY += (state.bvy * 0.10) * (state.aiPredict); // extra read at higher levels
    }

    targetY = clamp(targetY, 12, state.h - state.paddleH - 12);

    var dy = targetY - state.botY;

    // Proportional controller with max speed
    var desired = dy * state.aiGain;         // px/s
    desired = clamp(desired, -state.aiMaxSpeed, state.aiMaxSpeed);

    state.botY = clamp(state.botY + desired * dt, 12, state.h - state.paddleH - 12);

    // occasional “lock” moments (lower chance at higher levels)
    if(Math.random() < state.aiLockChance){
      state.aiLock = 8 + Math.floor(Math.random() * 10);
    }
  }

  function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh){
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }

  function capBall(){
    var vx = state.bvx, vy = state.bvy;
    var sp = Math.sqrt(vx*vx + vy*vy);
    var max = state.maxBallSpeed;
    if(sp > max){
      var k = max / sp;
      state.bvx *= k;
      state.bvy *= k;
    }
  }

  function pointScored(winner){
    analytics.tennisLifetimePoints += 1;

    if(winner === 'you'){
      state.you += 1;

      logGame('POINT · YOU · rally ' + state.rally, 'ok');
      if(soundEnabled) pointSfx();

      trackEvent('cavbot_tennis_point', { winner:'you', you: state.you, bot: state.bot, rally: state.rally, level: state.level });

      // KEEP your reroute behavior: score once restores route
      if(!state.scoredOnce){
        state.scoredOnce = true;
        setTimeout(function(){ scheduleRestoreRedirect('scored_once'); }, 650);
      }

      resetPositions('bot');
    }else{
      state.bot += 1;

      logGame('POINT · CAVBOT · rally ' + state.rally, 'warn');
      if(soundEnabled) pointSfx();

      trackEvent('cavbot_tennis_point', { winner:'cavbot', you: state.you, bot: state.bot, rally: state.rally, level: state.level });

      resetPositions('you');
    }

    if(state.bestRallyThisMatch > (analytics.tennisBestRally || 0)){
      analytics.tennisBestRally = state.bestRallyThisMatch;
      persistAnalytics();
      logGame('ANALYTICS · new best rally: ' + analytics.tennisBestRally, 'ok');
      trackEvent('cavbot_tennis_rally_record', { bestRally: analytics.tennisBestRally, level: state.level });
    }

    render();

    if(state.you >= state.targetScore || state.bot >= state.targetScore){
      endMatch();
    }
  }

  function updateBall(dt){
    state.bx += state.bvx * dt;
    state.by += state.bvy * dt;

    // walls
    if(state.by <= 10){
      state.by = 10;
      state.bvy *= -1;
    }
    if(state.by >= state.h - 26){
      state.by = state.h - 26;
      state.bvy *= -1;
    }

    var ballX = state.bx, ballY = state.by, ballS = 16;

    // PLAYER paddle collide (left)
    var pX = state.playerX, pY = state.playerY;
    if(rectsOverlap(ballX, ballY, ballS, ballS, pX, pY, state.paddleW, state.paddleH) && state.bvx < 0){
      state.bx = pX + state.paddleW + 1;
      state.bvx *= -1;

      // add player influence (spin) based on movement
      state.bvy += clamp(state.playerVel * 9.0, -340, 340); // px/s impulse

      // level-scaled acceleration (keeps rallies tense)
      var spec = levelSpec(state.level);
      state.bvx *= spec.accel;
      state.bvy *= (1.008 + (spec.factor * 0.004));
      capBall();

      state.rally += 1;
      state.bestRallyThisMatch = Math.max(state.bestRallyThisMatch, state.rally);

      if(soundEnabled) hitSfx();
      trackEvent('cavbot_tennis_return', { who:'you', rally: state.rally, level: state.level });

      logGame('RETURN · YOU · rally ' + state.rally, 'ok');
    }

    // BOT paddle collide (right)
    var bX = state.botX, bY = state.botY;
    if(rectsOverlap(ballX, ballY, ballS, ballS, bX, bY, state.paddleW, state.paddleH) && state.bvx > 0){
      state.bx = bX - ballS - 1;
      state.bvx *= -1;

      // bot “aims” its return based on offset (stronger at higher levels)
      var center = bY + state.paddleH / 2;
      var offset = (state.by + 8) - center;

      var spec2 = levelSpec(state.level);
      state.bvy += clamp(offset * (12.0 + spec2.factor * 6.5), -520, 520);

      state.bvx *= (1.010 + (spec2.factor * 0.010));
      state.bvy *= (1.008 + (spec2.factor * 0.006));
      capBall();

      state.rally += 1;
      state.bestRallyThisMatch = Math.max(state.bestRallyThisMatch, state.rally);

      if(soundEnabled) hitSfx();
      trackEvent('cavbot_tennis_return', { who:'cavbot', rally: state.rally, level: state.level });

      logGame('RETURN · CAVBOT · rally ' + state.rally, 'warn');
    }

    // scoring
    if(state.bx < -40){
      pointScored('cavbot');
    }
    if(state.bx > state.w + 40){
      pointScored('you');
    }
  }

  /* ==========================================================
    FIXED TIMESTEP GAME LOOP (stops slow/fast randomness)
  ========================================================== */
  var FIXED_DT = 1/120;      // 120hz sim
  var MAX_FRAME_DT = 0.05;   // clamp if tab was inactive

  function step(dt){
    updateAI(dt);
    updateBall(dt);
  }

  function frame(ts){
    if(!state.running) return;

    if(!state.lastFrameTs) state.lastFrameTs = ts;
    var dt = (ts - state.lastFrameTs) / 1000;
    state.lastFrameTs = ts;

    dt = Math.min(dt, MAX_FRAME_DT);
    state.acc += dt;

    // run as many fixed steps as needed
    var guard = 0;
    while(state.acc >= FIXED_DT && guard < 10){
      step(FIXED_DT);
      state.acc -= FIXED_DT;
      guard += 1;
    }

    render();
    state.raf = requestAnimationFrame(frame);
  }

  /* ---------------------------
    Match lifecycle
  --------------------------- */
  function startMatch(isManualReset){
    restoreScheduled = false;

    seedDifficulty();
    resize();

    // kill CSS paddle lag during gameplay (no CSS file change)
    paddlePlayer.style.transition = 'none';
    paddleBot.style.transition = 'none';

    state.match = analytics.tennisMatches + 1;
    state.matchStart = performance.now();
    state.running = true;

    state.you = 0;
    state.bot = 0;

    state.rally = 0;
    state.bestRallyThisMatch = 0;

    state.scoredOnce = false;

    state.playerVel = 0;
    state.lastPlayerY = null;

    // reset sim timing
    state.lastFrameTs = 0;
    state.acc = 0;

    resetPositions('bot');

    logGame('CONTROL ROOM TENNIS · online · match ' + state.match, 'ok');
    logGame('LEVEL · ' + ('0'+state.level).slice(-2) + ' · ' + state.levelName, 'ok');
    logGame('BOT · max ' + Math.round(state.aiMaxSpeed) + 'px/s · gain ' + state.aiGain.toFixed(1), 'ok');
    logGame('BALL · serve ' + Math.round(state.serveSpeed) + 'px/s · cap ' + Math.round(state.maxBallSpeed) + 'px/s', 'ok');

    if(isManualReset){
      logGame('RESET · manual restart', 'warn');
      if(soundEnabled) blip(880, 45, 'square', 0.04);
    }

    trackEvent('cavbot_tennis_match_start', {
      match: state.match,
      level: state.level,
      levelName: state.levelName,
      wins: analytics.tennisWins,
      losses: analytics.tennisLosses,
      bestRally: analytics.tennisBestRally
    });

    persistAnalytics();

    if(state.raf != null) cancelAnimationFrame(state.raf);
    state.raf = requestAnimationFrame(frame);
  }

  function endMatch(){
    state.running = false;
    if(state.raf != null){
      cancelAnimationFrame(state.raf);
      state.raf = null;
    }

    analytics.tennisMatches += 1;
    var elapsedMs = state.matchStart ? (performance.now() - state.matchStart) : 0;

    var youWon = state.you > state.bot;
    if(youWon){
      analytics.tennisWins += 1;
      logGame('MATCH END · YOU WIN · ' + state.you + '-' + state.bot + ' · time ' + (elapsedMs/1000).toFixed(2) + 's', 'ok');
      if(soundEnabled) winSfx();

      if(analytics.tennisFastestWinMs == null || elapsedMs < analytics.tennisFastestWinMs){
        analytics.tennisFastestWinMs = elapsedMs;
        logGame('ANALYTICS · fastest win: ' + (elapsedMs/1000).toFixed(2) + 's', 'ok');
      }

      trackEvent('cavbot_tennis_match_end', { result:'win', scoreYou: state.you, scoreBot: state.bot, elapsedMs: elapsedMs, level: state.level });
    } else {
      analytics.tennisLosses += 1;
      logGame('MATCH END · CAVBOT WINS · ' + state.you + '-' + state.bot + ' · time ' + (elapsedMs/1000).toFixed(2) + 's', 'warn');
      if(soundEnabled) winSfx();
      trackEvent('cavbot_tennis_match_end', { result:'loss', scoreYou: state.you, scoreBot: state.bot, elapsedMs: elapsedMs, level: state.level });
    }

    persistAnalytics();
    session.tennisMatches = (session.tennisMatches || 0) + 1;

    // keep your restore logic
    setTimeout(function(){
      scheduleRestoreRedirect('match_end');
    }, 1200);
  }

  if(btnReset){
    btnReset.addEventListener('click', function(){
      state.armed = true;
      startMatch(true);
    });
  }

  /* ---------------------------
    DM typewriter
  --------------------------- */
  function startDmTypewriter(){
    if(!dmSegments.length || !dmCursorEl) return;
    var segIndex = 0;

    function typeNext(){
      if(segIndex >= dmSegments.length) return;
      var el = dmSegments[segIndex];
      var full = el.getAttribute('data-text') || '';
      var i = 0;

      function step(){
        el.textContent = full.slice(0, i);
        i += 1;
        if(i <= full.length){
          setTimeout(step, 22 + Math.random() * 28);
        } else {
          segIndex += 1;
          if(segIndex < dmSegments.length) setTimeout(typeNext, 360);
        }
      }
      step();
    }
    typeNext();
  }

  /* ---------------------------
    DM badge pupils follow the ball (unchanged)
  --------------------------- */
  (function initAvatarEyesToBall(){
    var pupils = Array.prototype.slice.call(document.querySelectorAll('.cavbot-dm-eye-pupil'));
    if(!pupils.length) return;

    function update(){
      var r = court.getBoundingClientRect();
      var ballCx = r.left + state.bx + 8;
      var ballCy = r.top + state.by + 8;

      pupils.forEach(function(p){
        var avatar = p.closest('.cavbot-dm-avatar');
        if(!avatar) return;
        var a = avatar.getBoundingClientRect();
        var cx = a.left + a.width/2;
        var cy = a.top + a.height/2;

        var relX = (ballCx - cx) / (a.width/2);
        var relY = (ballCy - cy) / (a.height/2);

        relX = clamp(relX, -1, 1);
        relY = clamp(relY, -1, 1);

        var maxShift = 4;
        p.style.transform = 'translate(' + (relX*maxShift).toFixed(2) + 'px,' + (relY*maxShift).toFixed(2) + 'px)';
      });

      requestAnimationFrame(update);
    }
    requestAnimationFrame(update);
  })();

  /* ---------------------------
    Boot
  --------------------------- */
  logGame('CONTROL ROOM · ONLINE', 'ok');
  logGame('STACK · CAVCORE · GAME LAYER', 'ok');
  logGame('MODULE · CONTROL ROOM TENNIS', 'ok');
  logGame('LEVEL ROTATION · this visit: L' + state.level + ' · next visit: L' + ((state.level % 6) + 1), 'ok');
  logGame('ANALYTICS · matches: ' + analytics.tennisMatches + ' · wins: ' + analytics.tennisWins + ' · losses: ' + analytics.tennisLosses, 'ok');
  if(analytics.tennisBestRally){
    logGame('ANALYTICS · best rally: ' + analytics.tennisBestRally, 'ok');
  }

  // Seed chat log EXACTLY like your screenshot (same lines + timestamps)
  logChat('Okay. Deep breath. Now move …', 'tag', '15:43:48');
  logChat('That swing was a rumor.', 'tag', '15:43:54');
  logChat('Score update: you got nervous…', 'tag', '15:43:54');
  logChat('If you’re tired, blink quick…', 'tag', '15:43:54');

  setSoundUI();
  startDmTypewriter();

  // Initialize geometry & thumbnail stance, but DO NOT start match
  resize();
  // ensure HUD shows the level even before match begins
  seedDifficulty();
  render();

})();
