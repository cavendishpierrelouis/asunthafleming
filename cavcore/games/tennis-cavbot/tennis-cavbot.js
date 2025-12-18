/* ==========================================================
   Control Room Tennis · CavBot (hover-to-start + docked UI)
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
    trackEvent('cavbot_tennis_route_restore', { reason: reason || 'scored_once', to: RESTORE_URL });

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
  function logChat(text, level, tsOverride){ appendLog(chatLogInner, text, level, tsOverride); } // restored

  /* ---------------------------
     Difficulty (same thresholds)
     --------------------------- */
  function difficultyTier(){
    var w = analytics.tennisWins || 0;
    var m = analytics.tennisMatches || 0;
    var rate = m ? (w / m) : 0;

    if(m >= 18 && rate >= 0.62) return 'Expert';
    if(m >= 10 && rate >= 0.52) return 'Advanced';
    if(m >= 4) return 'Intermediate';
    return 'Rookie';
  }

  function difficultyFactor(tier){
    switch(tier){
      case 'Intermediate': return 1.12;
      case 'Advanced': return 1.26;
      case 'Expert': return 1.42;
      default: return 1.0;
    }
  }

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

  // Tennis-flavored pattern (still “original synth”, no sampling)
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

      trackEvent('cavbot_tennis_sound_toggle', { enabled: soundEnabled });
    });
  }

  /* ---------------------------
     Game state
     --------------------------- */
  var state = {
    match: analytics.tennisMatches + 1,
    matchStart: null,
    running: false,
    armed: false,
    raf: null,

    w: 0, h: 0,

    paddleH: 86,
    paddleW: 14,

    // positions (top-left for transforms)
    playerX: 0, playerY: 0,
    botX: 0, botY: 0,
    bx: 0, by: 0,

    // velocity
    bvx: 0, bvy: 0,
    speed: 6.2,

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

    // AI
    aiLock: 0,
    aiReaction: 0.14,
    aiMaxSpeed: 7.2,

    // difficulty
    tier: 'Rookie',
    factor: 1,

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
      statDifficultyEl.textContent = state.tier;
    }
  }

  /* ---------------------------
     Idle “thumbnail stance”
     - paddles centered on the net
     - ball centered, no motion
     --------------------------- */
  function setIdlePositions(){
    // centered paddles with a small gap around the net
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

    // clamp in-bounds
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
     Input
     - game does NOT start until hover/touch arms it + first movement
     --------------------------- */
  function noteInput(){
    state.lastInputTs = performance.now();
  }

  function armServe(){
    if(state.armed) return;
    state.armed = true;
    logGame('SERVE · armed (move to start)', 'ok');
    trackEvent('cavbot_tennis_armed', { armed: true });
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

  court.addEventListener('mouseenter', function(){
    armServe();
  });

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

  /* ---------------------------
     Difficulty seeding
     --------------------------- */
  function seedDifficulty(){
    state.tier = difficultyTier();
    state.factor = difficultyFactor(state.tier);

    state.aiReaction = 0.14 / state.factor;
    state.aiMaxSpeed = 7.2 * state.factor;
    state.speed = 6.2 * (0.92 + (state.factor * 0.12));
  }

  function resetPositions(servingTo){
    state.playerX = 16;
    state.botX = state.w - 16 - state.paddleW;

    state.playerY = clamp(state.playerY, 12, state.h - state.paddleH - 12);
    state.botY = (state.h / 2) - (state.paddleH / 2);

    state.bx = (state.w / 2) - 8;
    state.by = (state.h / 2) - 8;

    var dir = (servingTo === 'bot') ? 1 : -1;
    var angle = (Math.random() * 0.9 - 0.45);
    var base = state.speed;

    state.bvx = dir * (base + Math.random() * 0.8);
    state.bvy = angle * (base + Math.random() * 0.6);

    state.rally = 0;
    render();
  }

  /* ---------------------------
     AI + physics
     --------------------------- */
  function updateAI(){
    if(state.aiLock > 0){
      state.aiLock -= 1;
      return;
    }

    var targetY = state.by - (state.paddleH / 2) + 8;

    if(state.bvx > 0){
      targetY += (state.bvy * 4.5) * (0.65 + (state.factor * 0.15));
    }

    targetY = clamp(targetY, 12, state.h - state.paddleH - 12);

    var dy = targetY - state.botY;
    var step = clamp(dy * state.aiReaction, -state.aiMaxSpeed, state.aiMaxSpeed);
    state.botY = clamp(state.botY + step, 12, state.h - state.paddleH - 12);

    if(Math.random() < (0.010 / state.factor)){
      state.aiLock = 8 + Math.floor(Math.random() * 10);
    }
  }

  function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh){
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }

  function pointScored(winner){
    analytics.tennisLifetimePoints += 1;

    if(winner === 'you'){
      state.you += 1;

      logGame('POINT · YOU · rally ' + state.rally, 'ok');
      if(soundEnabled) pointSfx();

      trackEvent('cavbot_tennis_point', { winner:'you', you: state.you, bot: state.bot, rally: state.rally });

      if(!state.scoredOnce){
        state.scoredOnce = true;
        setTimeout(function(){ scheduleRestoreRedirect('scored_once'); }, 650);
      }

      resetPositions('bot');
    }else{
      state.bot += 1;

      logGame('POINT · CAVBOT · rally ' + state.rally, 'warn');
      if(soundEnabled) pointSfx();

      trackEvent('cavbot_tennis_point', { winner:'cavbot', you: state.you, bot: state.bot, rally: state.rally });

      resetPositions('you');
    }

    if(state.bestRallyThisMatch > (analytics.tennisBestRally || 0)){
      analytics.tennisBestRally = state.bestRallyThisMatch;
      persistAnalytics();
      logGame('ANALYTICS · new best rally: ' + analytics.tennisBestRally, 'ok');
      trackEvent('cavbot_tennis_rally_record', { bestRally: analytics.tennisBestRally });
    }

    render();

    if(state.you >= state.targetScore || state.bot >= state.targetScore){
      endMatch();
    }
  }

  function updateBall(){
    state.bx += state.bvx;
    state.by += state.bvy;

    if(state.by <= 10){
      state.by = 10;
      state.bvy *= -1;
    }
    if(state.by >= state.h - 26){
      state.by = state.h - 26;
      state.bvy *= -1;
    }

    var ballX = state.bx, ballY = state.by, ballS = 16;

    var pX = state.playerX, pY = state.playerY;
    if(rectsOverlap(ballX, ballY, ballS, ballS, pX, pY, state.paddleW, state.paddleH) && state.bvx < 0){
      state.bx = pX + state.paddleW + 1;
      state.bvx *= -1;

      state.bvy += clamp(state.playerVel * 0.18, -2.2, 2.2);
      state.bvx *= (1.03 + (state.factor * 0.01));
      state.bvy *= 1.01;

      state.rally += 1;
      state.bestRallyThisMatch = Math.max(state.bestRallyThisMatch, state.rally);

      if(soundEnabled) hitSfx();
      trackEvent('cavbot_tennis_return', { who:'you', rally: state.rally });

      logGame('RETURN · YOU · rally ' + state.rally, 'ok');
    }

    var bX = state.botX, bY = state.botY;
    if(rectsOverlap(ballX, ballY, ballS, ballS, bX, bY, state.paddleW, state.paddleH) && state.bvx > 0){
      state.bx = bX - ballS - 1;
      state.bvx *= -1;

      var center = bY + state.paddleH / 2;
      var offset = (state.by + 8) - center;
      state.bvy += clamp(offset * 0.03 * state.factor, -2.6, 2.6);

      state.bvx *= (1.02 + (state.factor * 0.02));
      state.bvy *= 1.01;

      state.rally += 1;
      state.bestRallyThisMatch = Math.max(state.bestRallyThisMatch, state.rally);

      if(soundEnabled) hitSfx();
      trackEvent('cavbot_tennis_return', { who:'cavbot', rally: state.rally });

      logGame('RETURN · CAVBOT · rally ' + state.rally, 'warn');
    }

    if(state.bx < -40){
      pointScored('cavbot');
    }
    if(state.bx > state.w + 40){
      pointScored('you');
    }
  }

  function loop(){
    if(!state.running) return;

    updateAI();
    updateBall();
    render();

    state.raf = requestAnimationFrame(loop);
  }

  /* ---------------------------
     Match lifecycle
     --------------------------- */
  function startMatch(isManualReset){
    restoreScheduled = false;

    seedDifficulty();
    resize();

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

    resetPositions('bot');

    logGame('CONTROL ROOM TENNIS · online · match ' + state.match, 'ok');
    logGame('DIFFICULTY · ' + state.tier + ' · factor ' + state.factor.toFixed(2), 'ok');
    if(isManualReset){
      logGame('RESET · manual restart', 'warn');
      if(soundEnabled) blip(880, 45, 'square', 0.04);
    }

    trackEvent('cavbot_tennis_match_start', {
      match: state.match,
      difficulty: state.tier,
      wins: analytics.tennisWins,
      losses: analytics.tennisLosses,
      bestRally: analytics.tennisBestRally
    });

    persistAnalytics();

    if(state.raf != null) cancelAnimationFrame(state.raf);
    state.raf = requestAnimationFrame(loop);
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

      trackEvent('cavbot_tennis_match_end', { result:'win', scoreYou: state.you, scoreBot: state.bot, elapsedMs: elapsedMs });
    } else {
      analytics.tennisLosses += 1;
      logGame('MATCH END · CAVBOT WINS · ' + state.you + '-' + state.bot + ' · time ' + (elapsedMs/1000).toFixed(2) + 's', 'warn');
      if(soundEnabled) winSfx();
      trackEvent('cavbot_tennis_match_end', { result:'loss', scoreYou: state.you, scoreBot: state.bot, elapsedMs: elapsedMs });
    }

    persistAnalytics();
    session.tennisMatches = (session.tennisMatches || 0) + 1;

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
     DM badge pupils follow the ball (nice touch)
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
  logGame('ANALYTICS · matches: ' + analytics.tennisMatches + ' · wins: ' + analytics.tennisWins + ' · losses: ' + analytics.tennisLosses, 'ok');
  if(analytics.tennisBestRally){
    logGame('ANALYTICS · best rally: ' + analytics.tennisBestRally, 'ok');
  }

  // Seed chat log EXACTLY like the screenshot (same lines + timestamps)
  logChat('Okay. Deep breath. Now move …', 'tag', '15:43:48');
  logChat('That swing was a rumor.', 'tag', '15:43:54');
  logChat('Score update: you got nervous…', 'tag', '15:43:54');
  logChat('If you’re tired, blink quick…', 'tag', '15:43:54');

  setSoundUI();
  startDmTypewriter();

  // Initialize geometry & thumbnail stance, but DO NOT start match
  resize();

})();