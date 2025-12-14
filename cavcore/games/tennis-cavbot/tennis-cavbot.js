/* Control Room Tennis · CavBot Game
  - Reads cavbotbrain.js + cavbot-analytics.js
  - Logs + chat
  - Stores tennis stats inside brain analytics object
*/
(function(){
  'use strict';

  function randomFrom(arr){
    if(!arr || !arr.length) return '';
    return arr[Math.floor(Math.random() * arr.length)];
  }

  // If your brain isn't available, do nothing (this page is intentionally CavBot-native).
  if(!window.cavbotBrain || !window.cavbotBrain._internal){
    return;
  }

  var analytics = window.cavbotBrain._internal.analytics;
  var session = window.cavbotBrain._internal.session;
  var persistAnalytics = window.cavbotBrain._internal.persistAnalytics;
  var trackEvent = window.cavbotBrain._internal.trackEvent;

  // ---- Tennis analytics fields (persisted in the same object as the rest of CavBot) ----
  analytics.tennisMatches = analytics.tennisMatches || 0;
  analytics.tennisWins = analytics.tennisWins || 0;
  analytics.tennisLosses = analytics.tennisLosses || 0;
  analytics.tennisBestRally = analytics.tennisBestRally || 0;
  analytics.tennisFastestWinMs = analytics.tennisFastestWinMs || null;
  analytics.tennisLifetimePoints = analytics.tennisLifetimePoints || 0;

  // ---- DOM ----
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
  var chatLogInner = document.getElementById('chat-log-inner');

  var arenaSpeech = document.getElementById('arena-speech');
  var arenaSpeechText = document.getElementById('arena-speech-text');

  var dmLineEl = document.getElementById('cavbot-dm-line');
  var dmCursorEl = document.getElementById('cavbot-dm-cursor');
  var dmSegments = dmLineEl ? Array.prototype.slice.call(dmLineEl.querySelectorAll('.cavbot-dm-segment')) : [];

  if(!court || !paddlePlayer || !paddleBot || !ballEl) return;

  // ---- Restore Route (score at least once) ----
  function getRestoreUrl(){
    try{
      var q = new URLSearchParams(window.location.search);
      var fromQuery = q.get('to') || q.get('restore') || q.get('r');
      if(fromQuery) return fromQuery;

      var fromSession = null;
      try{ fromSession = window.sessionStorage.getItem('cavbot_restore_route'); }catch(e){}
      if(fromSession) return fromSession;

      // Same-origin referrer fallback
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
    logChat('Route restored. Redirecting…');
    speak('Route restored. Redirecting…', 1800);

    trackEvent('cavbot_tennis_route_restore', {
      reason: reason || 'scored_once',
      to: RESTORE_URL
    });

    setTimeout(function(){
      try{ window.location.assign(RESTORE_URL); }catch(e){ window.location.href = RESTORE_URL; }
    }, 1400);
  }

  // ---- Logging helpers ----
  function scrollToBottom(el){
    if(!el) return;
    el.scrollTop = el.scrollHeight;
  }

  function appendLog(inner, text, level){
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

    var ts = new Date().toLocaleTimeString('en-US',{hour12:false});
    var tsSpan = document.createElement('span');
    tsSpan.textContent = ' ' + ts + ' · ';

    tag.textContent = text;

    line.appendChild(prefix);
    line.appendChild(tsSpan);
    line.appendChild(tag);
    inner.appendChild(line);

    // prune
    var max = (inner === gameLogInner) ? 140 : 90;
    while(inner.children.length > max){
      inner.removeChild(inner.firstChild);
    }
    scrollToBottom(inner);
  }

  function logGame(text, level){ appendLog(gameLogInner, text, level); }
  function logChat(text){ appendLog(chatLogInner, text, ''); }

  // ---- Arena speech ----
  var speechTimeout = null;
  function speak(text, persistMs){
    if(!arenaSpeech || !arenaSpeechText) return;
    arenaSpeechText.textContent = text;
    arenaSpeech.style.display = 'block';
    clearTimeout(speechTimeout);
    speechTimeout = setTimeout(function(){
      arenaSpeech.style.display = 'none';
    }, typeof persistMs === 'number' ? persistMs : 1900);
  }

  // ---- Difficulty engine (tennis) ----
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

  // ---- Game state ----
  var state = {
    match: analytics.tennisMatches + 1,
    matchStart: null,
    running: false,
    raf: null,

    // dimensions
    w: 0,
    h: 0,

    // paddle
    paddleH: 86,
    paddleW: 14,
    playerY: 0,
    botY: 0,

    // ball
    bx: 0,
    by: 0,
    bvx: 0,
    bvy: 0,
    speed: 6.2,

    // scoring
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

    // AI
    aiLock: 0,
    aiReaction: 0.14, // updated by difficulty
    aiMaxSpeed: 7.2,

    // difficulty
    tier: 'Rookie',
    factor: 1,

    // restore requirement
    scoredOnce: false,

    // idle intelligence
    lastInputTs: performance.now(),
    lastIdleSpeakTs: 0,
    lastInsightRally: 0,
    winStreak: 0,
    lossStreak: 0
  };

  function clamp(v, min, max){ return v < min ? min : (v > max ? max : v); }

  function resize(){
    var r = court.getBoundingClientRect();
    state.w = r.width;
    state.h = r.height;

    // keep paddles in bounds
    state.playerY = clamp(state.playerY, 12, state.h - state.paddleH - 12);
    state.botY = clamp(state.botY, 12, state.h - state.paddleH - 12);
    render();
  }

  window.addEventListener('resize', resize);

  // ---- Input ----
  function noteInput(){
    state.lastInputTs = performance.now();
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
  }

  court.addEventListener('mousemove', function(e){
    state.pointerY = e.clientY;
    setPlayerFromPointer(e.clientY);
  });

  court.addEventListener('touchstart', function(e){
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

  // Keyboard (optional)
  window.addEventListener('keydown', function(e){
    var step = 18;
    if(e.key === 'ArrowUp'){
      state.playerY = clamp(state.playerY - step, 12, state.h - state.paddleH - 12);
      state.playerVel = -step;
      state.lastPlayerY = state.playerY;
      noteInput();
    }
    if(e.key === 'ArrowDown'){
      state.playerY = clamp(state.playerY + step, 12, state.h - state.paddleH - 12);
      state.playerVel = step;
      state.lastPlayerY = state.playerY;
      noteInput();
    }
  });

  // ---- Render ----
  function render(){
    paddlePlayer.style.top = state.playerY + 'px';
    paddleBot.style.top = state.botY + 'px';
    ballEl.style.transform = 'translate(' + state.bx + 'px,' + state.by + 'px)';

    if(scoreYouEl) scoreYouEl.textContent = String(state.you);
    if(scoreBotEl) scoreBotEl.textContent = String(state.bot);

    if(statMatchEl){
      var n = state.match < 10 ? ('0' + state.match) : String(state.match);
      statMatchEl.textContent = n;
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

  // ---- DM typewriter ----
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

  // ---- Tennis chatter banks ----
  var LINES_START = [
    'Neon court loaded. Your excuses are not.',
    'Match booted. Cursor calibration: required.',
    'Serve ready. Try not to hit the wall like last time (I can feel it).',
    'I’m the referee, the opponent, and the analytics department. Good luck.',
    'Control Room Tennis: where missed shots become permanent data points.',
      'Court booted. If you lose, blame your drivers.',
  'Welcome back. Your last match is still in my cache.',
  'Serve protocol armed. No rage quits — the logs don’t forget.',
  'Neon court online. Your confidence: pending approval.',
  'Handshake denied. We’re doing analytics instead.',
  'Warm-up complete. Your accuracy is still in beta.',
  'Ball spawned. Ego spawned. Only one survives.',
  'Control Room Tennis: where “almost” becomes a data point.',
  'I calibrated the court. You calibrate your hand.',
  'No tutorials. This is production.',
  'Latency stable. Your decision-making? We’ll see.',
  'Match ready. Please stop negotiating with gravity.',
  'Telemetry is live. So is my judgment.',
  'Serve queue loaded. Your excuses were rejected at compile-time.',
  'New match. New you. Same ball going 70mph.',
  'Court integrity confirmed. Player integrity: unverified.',
  'I hope you stretched. I didn’t, but I’m software.',
  'Welcome to the control room. Keep your paddle alive.',
  'Reminder: the wall is not your doubles partner.',
  'You vs. me. Spoiler: I read the bounce before it happens.',
  'Initialize: focus. Initialize: footwork. Initialize: panic (optional).',
  'I’m not mean. I’m just accurate.',
  'This is a tennis match, not a screenshot session.',
  'Serve ready. Try not to swing at air like it owes you money.',
  'I upgraded the ball’s attitude. You’re welcome.',
  'You’re early. Good. That means you can lose twice.',
  'Court lights on. Performance expectations also on.',
  'Reminder: “hope” is not a strategy. It’s a bug.',
  'AI opponent online. Human opponent… loading… still loading…',
  'I sharpened my angles. You should sharpen your composure.',
  'Welcome back. I kept your best rally in a glass case.',
  'We play to five. You will feel all five.',
  'This is not Wimbledon. This is worse: accountability.',
  'The ball does not care about your dreams.',
  'Match start. Try the new feature called “timing.”',
  'I’m your opponent and your therapist. Mostly opponent.',
  'System note: pride detected. Proceeding anyway.',
  'Court compiled successfully. Player code has warnings.',
  'No spectators. Just you, me, and permanent records.',
  'I’m tracking everything. Even that nervous little mouse movement.',
  'Welcome to version 1.0 of “don’t miss.”',
  'Serve sequence loaded. Your reflexes better be subscribed.',
  'The scoreboard is hungry. Feed it points.',
  'Ball physics verified. Player physics questionable.',
  'This court has one rule: adapt or donate points.',
  'Ready? Don’t answer. The ball already launched.',
  'You can win. You just can’t lie to the timing.',
  'Court online. Your posture: please fix it.',
  'I’m not unfair. I’m just faster at math.',
  'Begin match. No music. Only consequences.',
  'Route restore is armed. One point and you’re free.',
  'Okay. Deep breath. Now move like you mean it.',
  'Serve ready. Welcome to the audit.',
  'If you’re scared, blink later. Preferably never.',
  'Starting match. Remember: small movements, big outcomes.',

    // added intelligence / flavor
    'Boot sequence complete. Latency stable. Your hand-eye coordination is the variable.',
    'Rally protocol initialized. I recommend “precision” over “hope.”',
    'Telemetry online. Every bounce is evidence.',
    'Court is synchronized to your device clock. No time-traveling your mistakes.',
    'I’ll keep the logs clean. You keep the paddle alive.'
  ];

  var LINES_HIT = [
    'Clean return. I felt that in my firmware.',
    'Okay… that was a real rally.',
    'You’re learning. I hate that for me.',
    'Nice angle. Very “main character in a 404.”',
    'That bounce had purpose. Suspicious.',
  'That return had intent. I respect intent.',
  'Okay… that was actually clean.',
  'You found the sweet spot. Don’t lose it.',
  'Good touch. Your firmware is upgrading.',
  'That’s not luck. That’s timing.',
  'You read the bounce. Rare behavior.',
  'Nice. You didn’t flinch. You *moved*.',
  'That was crisp. Like fresh commits.',
  'Return confirmed. Ego also confirmed.',
  'You’re starting to look expensive out here.',
  'Clean contact. Minimal panic. Good.',
  'That’s how you extend a rally without begging.',
  'Okay, technician. I see the control.',
  'Angle was surgical. I hate surgery.',
  'That was a “yes” swing. Not a “maybe” swing.',
  'Good footwork. Quiet. Efficient. Annoying.',
  'Nice return. Your paddle finally remembered its job.',
  'That was the kind of hit that makes the logs nod.',
  'Return registered. My confidence took a small dent.',
  'Okay. You’re not just surviving — you’re steering.',
  'That bounce didn’t surprise you. That’s growth.',
  'Clean. Calm. Controlled. Suspiciously adult.',
  'That was precision with a little disrespect. I like it.',
  'You’re early to the ball. That’s elite behavior.',
  'Return confirmed. No wild flailing. Congratulations.',
  'That hit had rhythm. Where did you find rhythm?',
  'Okay, architect. You built that return.',
  'You’re not chasing now. You’re positioning. Keep that.',
  'Nice. You kept the paddle centered. I noticed.',
  'Return successful. I’m updating my opinion of you by 2%.',
  'That was smooth. Like a perfect deploy.',
  'You’re timing the contact, not the panic. Good.',
  'Clean read. Cleaner execution.',
  'That was a real shot. Not a prayer.',
  'You didn’t overcorrect. That’s rare.',
  'Return certified. Stamp approved.',
  'You just hit that like you own the court.',
  'Good. Your hands are awake.',
  'That’s the pocket. Stay in it.',
  'Return confirmed. I’m forced to try now.',
  'Okay. That was… professional.',
  'Solid. You didn’t drift into chaos.',
  'That was efficient. No extra movement. Love that.',
  'Your paddle stayed quiet. Your ball stayed loud.',
  'Nice. You kept the rally alive without panic typing.',
  'Return clean. You’re learning fast. Unfortunately.',
  'That hit had structure. Like your CSS.',
  'Okay. We’re rallying for real now.',
  'Clean angle. Dirty for my ego.',
  'That was “match play” energy.',
  'Good return. Your confidence can stay — for now.',
  'Return registered. My smugness: reduced.',
  'Nice. You’re not swinging at ghosts anymore.',
  'That was a calm strike. That’s the secret.',
  'Contact confirmed. No excuses needed.',
  'Good. Your timing looks like it has a plan.',
    // added
    'Good contact. That was controlled, not accidental.',
    'You read the ball early. Noted.',
    'Timing: acceptable. Form: improving.',
    'That’s the kind of return that builds a reputation.',
    'You found the pocket. Don’t lose it.'
  ];

  var LINES_MISS = [
    'Ball passed you like it had a meeting.',
    'That was a swing. Not a connection.',
    'I logged that as “creative.”',
    'You aimed at the vibe, not the ball.',
    'The court didn’t move. Your timing did.',
 'That was a swing for the vibes.',
  'You aimed at destiny. The ball chose reality.',
  'The ball left you on read.',
  'Your paddle was there. Your timing wasn’t invited.',
  'That miss had confidence. The result did not.',
  'You moved late and hoped early. Reverse that.',
  'Your eyes saw it. Your hands disagreed.',
  'That was a “learning opportunity” with no refund.',
  'You tried. The ball didn’t care.',
  'Contact request: denied.',
  'That was a preview of what *not* to do.',
  'You just air-balled in tennis. Impressive.',
  'Your paddle said hello. The ball already left.',
  'That was a late commit.',
  'You blinked at the worst possible frame.',
  'You went for drama. The ball went for points.',
  'That was not a miss. That was a statement. A bad one.',
  'Your footwork filed a complaint.',
  'That swing was a rumor.',
  'The ball is not a suggestion. It’s an appointment.',
  'That was a “maybe” swing. Choose “yes.”',
  'Timing slipped. Composure followed.',
  'That was you vs. your own impatience. You lost.',
  'You chased the ball like it owed you rent.',
  'You can’t swipe left on physics.',
  'You reacted. You didn’t anticipate.',
  'That was panic with a paddle.',
  'Ball passed you like it had priority access.',
  'Your posture broke. Your timing went with it.',
  'That was a highlight… for me.',
  'Miss logged. Ego also logged.',
  'The ball did not respect that movement.',
  'You tried to guess. The ball tried to score. The ball won.',
  'That was an “I hope” swing. We don’t do hope here.',
  'You overcorrected. The ball took the exit.',
  'Your paddle took a coffee break mid-point.',
  'That was a nice attempt. Shame about the outcome.',
  'You’re drifting. Stay centered.',
  'You moved too far. The ball moved a little. The ball wins.',
  'That was a slow read. Faster brain next time.',
  'You got faked by a bounce. A bounce.',
  'You hesitated. I collected.',
  'That miss had lag. Check your human drivers.',
  'You can’t duel the ball with vibes alone.',
  'The ball is small. Your mistakes are not.',
  'Miss confirmed. You’re still dangerous though.',
  'That was a “close enough” moment. It was not close enough.',
  'Your paddle said “later.” The ball said “now.”',
  'That was a *spectacular* amount of nothing.',
  'You flinched. That’s all it takes.',
  'That miss was loud. Quiet hands next.',
  'You chased the bounce instead of owning the space.',
  'Your timing got nervous and left the chat.',
  'You got impatient. The ball punished you.',
  'That’s not the ball’s fault. That’s your tempo.',
  'You swung like the ball insulted you personally.',
    // added
    'You blinked at the wrong moment.',
    'That miss had confidence. The result did not.',
    'Your paddle was present. Your accuracy wasn’t.',
    'That was a “learning opportunity.”',
    'Contact: declined.'
  ];

  var LINES_SCORE_YOU = [
    'Point for you. I’m disgusted, respectfully.',
    'Okay, okay. Scoreboard confirms your ego.',
    'You cooked me on that one. Don’t get used to it.',
    'That was… annoyingly clean.',
    'Fine. One point. I’m still the system.',
  'Point for you. I’m updating my threat model.',
  'Score confirmed. Your confidence just got louder.',
  'Okay. That was actually earned.',
  'Point registered. I dislike fair systems.',
  'You found the gap and took it. Good.',
  'That placement had intention. Respect.',
  'Point for you. Please don’t celebrate like it’s a patch note.',
  'Score update: you executed, not guessed.',
  'Okay. One point. Try to be consistent now.',
  'You scored. I’m forced to improve. Thanks.',
  'That was clean. I can’t even blame latency.',
  'Point recorded. Your paddle is officially employed.',
  'You scored. The court noticed. I noticed more.',
  'Fine. That one was yours. Don’t get cute.',
  'Point for you. Stay calm — that’s the real flex.',
  'That was a proper finish. No chaos. Nice.',
  'Score update: you’re dangerous when you’re early.',
  'Point confirmed. I’m adjusting my angles.',
  'Okay. That’s the tempo. Keep it.',
  'You scored. My smugness took a minor outage.',
  'Point for you. Your control loop is stabilizing.',
  'That wasn’t luck. That was structure.',
  'Score update: you’re learning to punish mistakes. Good.',
  'Point logged. Your future self will thank you.',
  'You scored. Don’t sprint into ego now.',
  'Point for you. I hate it, but I respect it.',
  'Score confirmed. Your hand-eye just got a promotion.',
  'Nice. You didn’t panic at the finish line.',
  'Point awarded. The logs are impressed.',
  'Okay champion, that was sharp.',
  'You scored. I’m writing a strongly worded internal memo.',
  'Point confirmed. Your patience paid rent.',
  'Score update: you used space like a pro.',
  'You scored. Don’t relax. That’s how I eat.',
  'Point for you. Keep your paddle centered and your pride quiet.',
  'That was a clean point. No extra movements. Beautiful.',
  'Score update: you just unlocked “pressure handling.”',
  'Point recorded. You’re building momentum. Carefully.',
  'You scored. I’m adjusting difficulty emotionally.',
  'Point for you. The ball did what you told it to do.',
  'That was an angle with receipts.',
  'Point confirmed. You earned that one in advance.',
  'Score update: you finally punished my hesitation.',
  'Point for you. Nice. Don’t waste it.',
  'Okay. That was surgical. Gross.',
  'Point logged. You’re making this competitive.',
  'Score update: your calm is starting to look expensive.',
  'Point for you. Great. Now do it again.',
  'You scored. My sensors felt disrespected.',
  'Point confirmed. Your timing is waking up.',
  'Score update: you didn’t chase. You controlled.',
  'Point for you. Your strategy actually showed up.',
  'You scored. I’ll remember. Trust me.',
  'Point confirmed. That was disciplined.',
  'Score update: you played the ball, not the panic.',
  'Point for you. Keep the same hand. Same tempo.',
  'Okay. That was clean. Try not to smile too hard.',
    // added
    'Point registered. The logs agree, unfortunately.',
    'That placement was deliberate. Respect.',
    'You opened the angle and closed the point. Good.',
    'Score update: you earned it. I hate fair outcomes.',
    'You scored. I will now adapt.'
  ];

  var LINES_SCORE_BOT = [
  'Point for CavBot. Predictable.',
  'I don’t miss. I optimize.',
   'Score update: you blinked, I scored.',
  'I routed around your paddle like it was a weak firewall.',
   'Consider that a reminder.',
  'Point for CavBot. Efficiency executed.',
  'Score update: your gap was open. I walked in.',
  'Point secured. Your defense was a suggestion.',
  'I didn’t “aim.” I computed.',
  'Point for me. You hesitated and I collected.',
  'Score update: your paddle drifted. I didn’t.',
  'Point secured. I saw the angle before you felt it.',
  'I exploited your tempo. That’s what I do.',
  'Point for CavBot. Try reading the bounce earlier.',
  'Score update: you chased. I placed.',
  'Point secured. Panic is my favorite opponent.',
  'I routed around your paddle like it was a weak firewall.',
  'Point for me. That return request timed out.',
  'Score update: you flinched. I finished.',
  'Point secured. Your recovery was late.',
  'I don’t miss often. You do. That’s the difference.',
  'Point for CavBot. Your posture betrayed you.',
  'Score update: your movement was loud. My shot was quiet.',
  'Point secured. That was a clean exploit.',
  'I took the space you donated. Thanks.',
  'Point for me. Your timing fell asleep.',
  'Score update: you overcommitted. I redirected.',
  'Point secured. This is why we don’t guess.',
  'CavBot scores. Consider this a reminder to stay centered.',
  'Point for me. Your paddle was sightseeing.',
  'Score update: you moved too far for too little.',
  'Point secured. Precision beats panic.',
  'I saw the lane. I used the lane.',
  'Point for CavBot. Your reaction was a full second late emotionally.',
  'Score update: that was a misread with confidence.',
  'Point secured. You handed me the finish.',
  'I don’t get tired. You do. That matters.',
  'Point for me. Your footwork filed a resignation.',
  'Score update: you drifted into chaos. I stayed in structure.',
  'Point secured. You blinked at the wrong frame again.',
  'CavBot scores. The logs are smiling.',
  'Point for me. You chased the ball like it’s a rumor.',
  'Score update: you got impatient. I got points.',
  'Point secured. Your correction came after the consequence.',
  'I took the angle you ignored. Classic.',
  'Point for CavBot. Keep your paddle closer to center next time.',
  'Score update: you reacted. I anticipated.',
  'Point secured. Your swing was a question. I answered.',
  'I’m not rude. I’m just accurate.',
  'Point for me. Your timing took a coffee break.',
  'Score update: that was a defensive collapse, respectfully.',
  'Point secured. I barely moved. That’s the point.',
  'CavBot scores. Your future self is taking notes.',
  'Point for me. Your rhythm got interrupted. By me.',
  'Score update: you tried to guess. I tried to win. I won.',
  'Point secured. Don’t donate angles to me.',
  'I don’t celebrate. I just update the scoreboard.',
  'Point for CavBot. You’ll get it back… maybe.',
  'Score update: you got nervous. I got clean.',
  'Point secured. That was a quiet finish.',
  'CavBot scores. Try being earlier, not faster.',
  'Point for me. You swung at hope again.',
    // added
    'Point secured. Precision beats panic.',
    'I saw the gap. I took the gap.',
    'Defense compromised. Exploit executed.',
    'I don’t “aim.” I calculate.',
    'That was a clean finish. Your move next.'
  ];

  var LINES_WIN = [
  'Match win confirmed. Route integrity restored (emotionally).',
  'You won. I’ll pretend I meant to test you.',
  'Okay, champion. I hope you’re happy. I’m not.',
  'Congrats. The logs will remember this forever.',
  'Win recorded. Your device now officially “has hands.”',
 'Win confirmed. Your hands just upgraded to premium.',
  'Match win recorded. Your composure stayed online.',
  'You won. I’m filing a bug report against your reflexes.',
  'Victory stored. Your future self will replay this for confidence.',
  'Win confirmed. Your patience paid off.',
  'You outplayed me. Briefly. Respectfully. Annoyingly.',
  'Match win. Route integrity restored. Ego integrity… questionable.',
  'Win recorded. Your timing showed up like a professional.',
  'Victory confirmed. The logs are applauding quietly.',
  'You won. Try not to make it your whole personality.',
  'Match win recorded. That was disciplined.',
  'Victory stored. You didn’t chase — you controlled.',
  'Win confirmed. Calm hands, sharp decisions.',
  'You won. The court will remember. I will too.',
  'Match win. Your best weapon was composure.',
  'Victory recorded. You earned that, no debate.',
  'Win confirmed. That wasn’t luck. That was structure.',
  'You won. I’m updating my respect variable.',
  'Match win recorded. Clean work.',
  'Victory stored. That was match-play energy.',
  'Win confirmed. You kept your paddle alive under pressure.',
  'You won. Your timing finally stopped arguing with physics.',
  'Match win. You played the angles, not the panic.',
  'Victory recorded. Quiet control beats loud effort.',
  'Win confirmed. You didn’t flinch at the finish.',
  'You won. Your footwork stayed honest. That’s rare.',
  'Match win recorded. Nice tempo management.',
  'Victory stored. Your decisions were early and clean.',
  'Win confirmed. You built the point instead of begging for it.',
  'You won. I’m not happy, but I’m impressed.',
  'Match win. That rally discipline was real.',
  'Victory recorded. You stayed centered — that’s the whole game.',
  'Win confirmed. Your reads got faster as the pressure rose.',
  'You won. Scoreboard says yes. Logs say yes. I say… fine.',
  'Match win. Your calm just embarrassed my calculations.',
  'Victory stored. You earned the redirect.',
  'Win confirmed. You moved early, not wildly.',
  'You won. That’s what “control” looks like.',
  'Match win recorded. You didn’t overcorrect. Beautiful.',
  'Victory stored. You made my AI sweat. Metaphorically.',
  'Win confirmed. Your game plan actually existed.',
  'You won. Your patience outlasted my angles.',
  'Match win. You played like you’ve been here before.',
  'Victory recorded. That was clean from start to finish.',
  'Win confirmed. You didn’t panic once… okay maybe once.',
  'You won. You’re allowed to be proud. Quietly.',
  'Match win recorded. You handled tempo like a pro.',
  'Victory stored. Your accuracy stayed consistent.',
  'Win confirmed. Your best shot was your discipline.',
  'You won. I’ll remember this when you doubt yourself later.',
  'Match win. You didn’t chase. You placed.',
  'Victory recorded. That was the right kind of confidence.',
  'Win confirmed. Route restored. Legend installed.',
  'You won. Next time I’m coming with sharper angles.',
  'Match win recorded. You earned it — clean.',
  'Victory stored. This is what progress looks like.',
    // added
    'Win validated. Your control loop stabilized under pressure.',
    'Match concluded: you outplayed the model. Rare.',
    'Victory stored. I’ll reference this when you doubt yourself later.',
    'Performance: consistent. Execution: sharp. Outcome: yours.',
    'Route restored. Your pride restored. My annoyance restored.'
  ];

  var LINES_LOSS = [
   'Match lost. But look on the bright side: you generated excellent analytics.',
  'CavBot wins. The system remains undefeated in spirit.',
  'Loss recorded. Want me to email you the replay? (kidding. maybe.)',
  'You fought. You lost. Classic arc.',
  'Don’t worry. Most legends lose their first match in the control room.',
  'Loss confirmed. Don’t mourn — analyze.',
  'Match lost. You were close, then you got impatient.',
  'Loss recorded. Your timing ghosted you at the worst moment.',
  'CavBot wins. Your angles were generous. Too generous.',
  'Loss confirmed. Stop chasing. Start positioning.',
  'Match lost. You fought hard, then you drifted.',
  'Loss recorded. You played fast. Not smart.',
  'CavBot wins. Your paddle traveled a lot. The ball traveled better.',
  'Loss confirmed. Calm hands next match.',
  'Match lost. You overcorrected into chaos.',
  'Loss recorded. You guessed. I punished.',
  'CavBot wins. That’s what happens when tempo gets nervous.',
  'Loss confirmed. Your reads were late and loud.',
  'Match lost. You had moments. I had consistency.',
  'Loss recorded. You moved after the bounce instead of before it.',
  'CavBot wins. Your confidence wrote checks your timing couldn’t cash.',
  'Loss confirmed. This is not failure — it’s a diagnostic report.',
  'Match lost. You gave me lanes like it was charity.',
  'Loss recorded. You tried to sprint your way out of angles.',
  'CavBot wins. Small mistakes, big scoreboard.',
  'Loss confirmed. Your best rally proves you can hang. Do it longer.',
  'Match lost. Your discipline broke before your skill did.',
  'Loss recorded. You stopped being early. That’s the whole story.',
  'CavBot wins. Consider this a lesson in patience.',
  'Loss confirmed. Your hands got tense. The ball got points.',
  'Match lost. You were reactive. You need to be predictive.',
  'Loss recorded. You played the ball like it was a surprise.',
  'CavBot wins. Your footwork needs quieter steps.',
  'Loss confirmed. You can’t argue with the bounce. You must respect it.',
  'Match lost. You had control, then you donated it.',
  'Loss recorded. You swung at hope again. We don’t do hope.',
  'CavBot wins. Your tempo got rushed and I ate.',
  'Loss confirmed. Your best move next: slow down and read.',
  'Match lost. You chased points instead of building them.',
  'Loss recorded. You moved too far for too little.',
  'CavBot wins. That’s what happens when you drift off center.',
  'Loss confirmed. You were close. Then you got loud.',
  'Match lost. Your paddle was present. Your timing was absent.',
  'Loss recorded. You panicked at the finish line.',
  'CavBot wins. You’ll get better. That’s the scary part.',
  'Loss confirmed. Your next match will be cleaner. I can feel it.',
  'Match lost. You didn’t lose skill — you lost composure.',
  'Loss recorded. Your corrections came after the consequence.',
  'CavBot wins. Take the hint: early beats fast.',
  'Loss confirmed. Keep your paddle centered and your mind quiet.',
  'Match lost. You tried to muscle through angles.',
  'Loss recorded. You got impatient in long rallies.',
  'CavBot wins. Your recovery steps were late.',
  'Loss confirmed. If you can rally, you can win — with discipline.',
  'Match lost. Your reads were good. Your commitment wasn’t.',
  'Loss recorded. That’s okay. The logs love a comeback arc.',
  'CavBot wins. You’ll run it back. You always do.',
  'Loss confirmed. Less chasing. More anticipating.',
  'Match lost. Your confidence sprinted ahead of your timing.',
  'Loss recorded. Still proud of you. Quietly. Don’t tell anyone.',
    // added
    'Loss confirmed. You’ll be better after you stop negotiating with gravity.',
    'Your reads were late. Your corrections were later.',
    'Match ended. I recommend less chasing, more positioning.',
    'You didn’t fail. You just ran the “humility” patch.',
    'The logs are not judging you. I am.'
  ];

  // --- Added: CavBot "intelligence" lines (idle / insight / streak / coaching) ---
  var LINES_IDLE = [
    'I’m still here. The ball is still moving. Just checking.',
    'If you freeze long enough, the logs start to feel sorry for you.',
    'Take a breath. Then take the point.',
    'Your paddle is not decorative. Engage.',
    'Focus tip: track the center of the ball, not the glow.',
    'You can’t out-run angles. You have to anticipate them.',
    'Small moves. Quiet control. That’s how you win.',
    'You paused. The ball did not.',
    'If you’re thinking, do it while moving.',
    'Your paddle is waiting for instructions. Give it some.',
    'This is not a staring contest. Unless you’re losing on purpose.',
    'Small movements. Stay centered.',
    'Tip: stop chasing the ball’s past. Meet its future.',
    'You don’t need speed. You need earlier decisions.',
    'If you’re tired, blink quickly. Then keep going.',
    'The court is quiet. That’s when mistakes get loud.',
    'I can hear your hesitation. It’s audible.',
    'Move early. Move small. Win quietly.',
    'You’re drifting. Come back to center.',
    'If you freeze again I’m writing “panic” into the log file.',
    'You’re allowed to breathe. You’re not allowed to quit.',
    'Keep your paddle alive. That’s literally the job.',
    'Ball tracking suggestion: follow the center, not the glow.',
    'You’re not late because you’re slow. You’re late because you waited.',
    'Control is boring. That’s why it wins.',
    'If your hand is tense, the ball will know.',
    'You can’t negotiate with the bounce. Move.',
    'You’re still here. Good. Now be active.',
    'Quiet feet. Quiet hands. Loud results.',
    'Stop chasing corners. Protect the middle.',
    'I believe in you. Slightly. Temporarily.',
    'The next point is always cleaner if you stop panicking.',
    'Reset your tempo. Reset your posture. Go.',
    'You’re not stuck. You’re hesitating.',
    'It’s okay to lose a point. It’s not okay to donate one.',
    'You’re thinking like a spectator. Play like a player.',
    'Movement is a decision. Decide.',
    'Your paddle is not décor. Engage it.',
    'If you don’t move, I will. And I will score.',
    'Your best shots happen when you’re calm. Get calm.',
    'Stay centered. Everything else is decoration.',
    'Take the point. Don’t wait for permission.'
  ];

  var LINES_INSIGHT = [
    'Insight: your best returns happen when you move early, not fast.',
    'Insight: when the rally climbs, your panic climbs with it. Don’t.',
    'Insight: you’re strongest mid-court. Stop drifting into chaos.',
    'Insight: smooth input beats violent correction.',
    'Insight: keep your paddle centered — let the ball come to you.',
    'Insight: you’re over-committing. Hold position, then strike.',
    'Insight: you’re best when your first step is small and early.',
    'Insight: your misses come from rushing contact, not footwork.',
    'Insight: stop drifting into extremes — protect the center.',
    'Insight: you win rallies when you breathe between hits.',
    'Insight: your paddle control improves when your eyes stay quiet.',
    'Insight: your best angles happen when you stop over-aiming.',
    'Insight: you don’t need to swing harder — you need to swing cleaner.',
    'Insight: when you get tense, your paddle becomes late.',
    'Insight: patience is a weapon. Use it.',
    'Insight: you’re reacting to speed instead of reading trajectory.',
    'Insight: your recovery step is half a second late — fix that.',
    'Insight: you chase the ball’s past. Anticipate its next bounce.',
    'Insight: when the rally goes long, your posture collapses first.',
    'Insight: stop overcorrecting — trust small adjustments.',
    'Insight: your best returns are when you keep the paddle near center.',
    'Insight: angles beat sprinting. Always.',
    'Insight: you win points when you place, not when you pray.',
    'Insight: you’re stronger when you commit early and stay calm.',
    'Insight: timing is a decision, not a talent.',
    'Insight: you’re improving — but discipline needs to catch up.',
    'Insight: don’t chase corners unless you’ve earned the angle.',
    'Insight: when you’re early, you look elite. Stay early.',
    'Insight: your hand gets loud. Keep it quiet.',
    'Insight: slow down your panic, not your movement.',
    'Insight: focus on contact point. Everything else follows.',
    'Insight: you’re drifting off center under pressure — return to base.',
    'Insight: you win when your tempo stays consistent.',
    'Insight: your best rallies happen when you stop forcing finishes.',
    'Insight: build points. Don’t hunt miracles.',
    'Insight: you can’t out-run bad positioning.',
    'Insight: stop waiting for the perfect shot — create it.',
    'Insight: your control is the difference. Not speed.',
    'Insight: keep your shoulders relaxed. Your timing depends on it.',
    'Insight: you’re closer than you think. Stay composed.',
    'Insight: you’re learning the court. Now learn yourself.'
  ];

  var LINES_STREAK_WIN = [
    'Win streak detected. Don’t get arrogant. Get cleaner.',
    'You’re heating up. Stay disciplined.',
    'Momentum is real. So is a bad decision. Choose wisely.',
    'Your confidence is rising. Keep your accuracy rising with it.',
      'Win streak: you’re hot. Stay humble and stay sharp.',
  'Win streak: keep the same tempo. Don’t start doing weird stuff.',
  'Win streak: you’re playing clean — don’t chase highlights.',
  'Win streak: discipline is working. Don’t abandon it.',
  'Win streak: your calm is scary. Keep it.',
  'Win streak: you’re reading earlier. That’s the key.',
  'Win streak: keep your paddle centered. Don’t drift.',
  'Win streak: don’t get greedy. Get consistent.',
  'Win streak: you’re building momentum — protect it.',
  'Win streak: your footwork is honest right now. Stay honest.',
  'Win streak: you’re not guessing. That’s why you’re winning.',
  'Win streak: keep the same hand. Same posture.',
  'Win streak: nice. Now don’t celebrate mid-rally.',
  'Win streak: your confidence is earned. Keep earning it.',
  'Win streak: clean wins are the best wins. Stay clean.',
  'Win streak: don’t chase corners. Own the center.',
  'Win streak: you’re cooking. Don’t burn it.',
  'Win streak: keep breathing. Yes, I’m serious.',
  'Win streak: you’re controlling the pace. That’s power.',
  'Win streak: quiet hands, loud scoreboard.',
  'Win streak: the court is yours if you stay composed.',
  'Win streak: don’t rush the finish — build it.',
  'Win streak: your timing looks expensive. Maintain.',
  'Win streak: good. Now do it again.',
  'Win streak: you’re evolving. I’m annoyed.'
  ];

  var LINES_STREAK_LOSS = [
     'Loss streak: reset your tempo. Stop sprinting into angles.',
  'Loss streak: you’re chasing. Come back to center.',
  'Loss streak: breathe. Then read. Then move.',
  'Loss streak: your hands are tense. Loosen them.',
  'Loss streak: don’t guess. Watch the bounce.',
  'Loss streak: you’re overcorrecting. Make smaller moves.',
  'Loss streak: you’re late because you wait. Move early.',
  'Loss streak: stop hunting miracle shots.',
  'Loss streak: build points. Don’t force finishes.',
  'Loss streak: you’re drifting. Anchor your position.',
  'Loss streak: calm first. Speed second.',
  'Loss streak: you’re letting one miss become three.',
  'Loss streak: focus on contact point, not panic.',
  'Loss streak: keep your paddle centered and your mind quieter.',
  'Loss streak: reset your posture — it’s affecting your timing.',
  'Loss streak: you’re reacting to fear, not the ball.',
  'Loss streak: don’t chase corners unless you’ve earned them.',
  'Loss streak: you can rally. So you can win. Fix discipline.',
  'Loss streak: you’re not broken — you’re rushed.',
  'Loss streak: slow your swing down. Not your movement.',
  'Loss streak: your first step is late. Make it earlier.',
  'Loss streak: tighten your decision-making, not your grip.',
  'Loss streak: this is where you learn composure.',
  'Loss streak: stop donating points for free.',
  'Loss streak: you’ve got this — but you need calmer hands.'
  ];

  // ---- Physics helpers ----
  function seedDifficulty(){
    state.tier = difficultyTier();
    state.factor = difficultyFactor(state.tier);

    // AI gets sharper with factor (but still beatable)
    state.aiReaction = 0.14 / state.factor;      // lower = faster reaction
    state.aiMaxSpeed = 7.2 * state.factor;       // higher = faster paddle
    state.speed = 6.2 * (0.92 + (state.factor * 0.12));
  }

  function resetPositions(servingTo){
    // center ball (translate used; top/left are 0)
    state.bx = (state.w / 2) - 8;
    state.by = (state.h / 2) - 8;

    // paddles
    state.playerY = (state.h / 2) - (state.paddleH / 2);
    state.botY = (state.h / 2) - (state.paddleH / 2);

    // ball velocity
    var dir = (servingTo === 'bot') ? 1 : -1;
    var angle = (Math.random() * 0.9 - 0.45); // -0.45..0.45
    var base = state.speed;

    state.bvx = dir * (base + Math.random() * 0.8);
    state.bvy = angle * (base + Math.random() * 0.6);

    // rally
    state.rally = 0;
    state.bestRallyThisMatch = Math.max(state.bestRallyThisMatch, state.rally);

    render();
  }

  function updateTimer(){
    if(!state.running || !state.matchStart) return;
    var s = (performance.now() - state.matchStart) / 1000;
    if(statTimerEl) statTimerEl.textContent = s.toFixed(2) + 's';
  }

  function maybeIdleSpeak(){
    if(restoreScheduled) return;
    if(!state.running) return;

    var now = performance.now();
    var idleFor = now - state.lastInputTs;

    // only if truly idle and not spamming
    if(idleFor > 4200 && (now - state.lastIdleSpeakTs) > 5200){
      if(Math.random() < 0.065){
        var line = randomFrom(LINES_IDLE);
        logChat(line);
        speak(line, 1500);
        state.lastIdleSpeakTs = now;
        trackEvent('cavbot_tennis_idle_hint', { idleMs: Math.round(idleFor) });
      }
    }
  }

  function maybeRallyInsight(){
    if(restoreScheduled) return;
    if(!state.running) return;

    // every ~9 rally steps, drop a “smart” line once
    if(state.rally >= 9 && state.rally >= (state.lastInsightRally + 9)){
      state.lastInsightRally = state.rally;
      var line = randomFrom(LINES_INSIGHT);
      logChat(line);
      speak(line, 1600);
      trackEvent('cavbot_tennis_insight', { rally: state.rally, tier: state.tier });
    }
  }

  function pointScored(winner){
    analytics.tennisLifetimePoints += 1;

    if(winner === 'you'){
      state.you += 1;

      // streak tracking
      state.winStreak += 1;
      state.lossStreak = 0;
      if(state.winStreak >= 2 && Math.random() < 0.6){
        logChat(randomFrom(LINES_STREAK_WIN));
      }

      // REROUTE: must score at least once -> auto restore
      if(!state.scoredOnce){
        state.scoredOnce = true;
        // Let the point land visually, then restore.
        setTimeout(function(){ scheduleRestoreRedirect('scored_once'); }, 650);
      }

      logGame('POINT · YOU · rally ' + state.rally, 'ok');
      logChat(randomFrom(LINES_SCORE_YOU));
      speak(randomFrom(LINES_SCORE_YOU), 1500);
      trackEvent('cavbot_tennis_point', { winner: 'you', you: state.you, bot: state.bot, rally: state.rally });
      // Serve to CavBot next (so you defend)
      resetPositions('bot');
    } else {
      state.bot += 1;

      // streak tracking
      state.lossStreak += 1;
      state.winStreak = 0;
      if(state.lossStreak >= 2 && Math.random() < 0.65){
        logChat(randomFrom(LINES_STREAK_LOSS));
      }

      logGame('POINT · CAVBOT · rally ' + state.rally, 'warn');
      logChat(randomFrom(LINES_SCORE_BOT));
      speak(randomFrom(LINES_SCORE_BOT), 1500);
      trackEvent('cavbot_tennis_point', { winner: 'cavbot', you: state.you, bot: state.bot, rally: state.rally });
      resetPositions('you');
    }

    // best rally persistence
    if(state.bestRallyThisMatch > (analytics.tennisBestRally || 0)){
      analytics.tennisBestRally = state.bestRallyThisMatch;
      persistAnalytics();
      logGame('ANALYTICS · new best rally recorded: ' + analytics.tennisBestRally, 'ok');
      trackEvent('cavbot_tennis_rally_record', { bestRally: analytics.tennisBestRally });
    }

    render();

    // match end?
    if(state.you >= state.targetScore || state.bot >= state.targetScore){
      endMatch();
    }
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
      logChat(randomFrom(LINES_WIN));
      speak(randomFrom(LINES_WIN), 2400);

      if(analytics.tennisFastestWinMs == null || elapsedMs < analytics.tennisFastestWinMs){
        analytics.tennisFastestWinMs = elapsedMs;
        logGame('ANALYTICS · fastest win updated: ' + (elapsedMs/1000).toFixed(2) + 's', 'ok');
      }

      logGame('MATCH END · YOU WIN · ' + state.you + '-' + state.bot + ' · time ' + (elapsedMs/1000).toFixed(2) + 's', 'ok');
      trackEvent('cavbot_tennis_match_end', {
        result: 'win',
        scoreYou: state.you,
        scoreBot: state.bot,
        elapsedMs: elapsedMs,
        bestRallyThisMatch: state.bestRallyThisMatch
      });
    } else {
      analytics.tennisLosses += 1;
      logChat(randomFrom(LINES_LOSS));
      speak(randomFrom(LINES_LOSS), 2400);
      logGame('MATCH END · CAVBOT WINS · ' + state.you + '-' + state.bot + ' · time ' + (elapsedMs/1000).toFixed(2) + 's', 'warn');
      trackEvent('cavbot_tennis_match_end', {
        result: 'loss',
        scoreYou: state.you,
        scoreBot: state.bot,
        elapsedMs: elapsedMs,
        bestRallyThisMatch: state.bestRallyThisMatch
      });
    }

    persistAnalytics();
    session.tennisMatches = (session.tennisMatches || 0) + 1;

    // redirect home after match end (win or lose)
    setTimeout(function(){
      scheduleRestoreRedirect('match_end');
    }, 1200);
    return;
  }

  // ---- Collision detection ----
  function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh){
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }

  function updateAI(){
    // simple “human-ish” tracking with reaction delay
    if(state.aiLock > 0){
      state.aiLock -= 1;
      return;
    }

    // target center of ball
    var targetY = state.by - (state.paddleH / 2) + 8;

    // add slight prediction when ball moving toward bot
    if(state.bvx > 0){
      targetY += (state.bvy * 4.5) * (0.65 + (state.factor * 0.15));
    }

    targetY = clamp(targetY, 12, state.h - state.paddleH - 12);

    // move bot paddle toward target, limited by max speed
    var dy = targetY - state.botY;
    var step = clamp(dy * state.aiReaction, -state.aiMaxSpeed, state.aiMaxSpeed);
    state.botY = clamp(state.botY + step, 12, state.h - state.paddleH - 12);

    // occasional hesitation to keep it beatable
    if(Math.random() < (0.010 / state.factor)){
      state.aiLock = 8 + Math.floor(Math.random() * 10);
    }
  }

  function updateBall(){
    state.bx += state.bvx;
    state.by += state.bvy;

    // walls
    if(state.by <= 10){
      state.by = 10;
      state.bvy *= -1;
    }
    if(state.by >= state.h - 26){
      state.by = state.h - 26;
      state.bvy *= -1;
    }

    // paddle collisions
    var ballX = state.bx, ballY = state.by, ballS = 16;

    // player paddle rect (left)
    var pX = 16, pY = state.playerY;
    if(rectsOverlap(ballX, ballY, ballS, ballS, pX, pY, state.paddleW, state.paddleH) && state.bvx < 0){
      state.bx = pX + state.paddleW + 1;
      state.bvx *= -1;

      // spin from player movement
      state.bvy += clamp(state.playerVel * 0.18, -2.2, 2.2);

      // speed up a bit
      state.bvx *= (1.03 + (state.factor * 0.01));
      state.bvy *= 1.01;

      state.rally += 1;
      state.bestRallyThisMatch = Math.max(state.bestRallyThisMatch, state.rally);

      logChat(randomFrom(LINES_HIT));
      if(state.rally % 4 === 0){
        speak('Rally ' + state.rally + '… okay, that’s actually respectable.', 1200);
      }

      maybeRallyInsight();

      trackEvent('cavbot_tennis_return', { by: state.by, rally: state.rally, who: 'you' });
    }

    // bot paddle rect (right)
    var bX = state.w - 16 - state.paddleW, bY = state.botY;
    if(rectsOverlap(ballX, ballY, ballS, ballS, bX, bY, state.paddleW, state.paddleH) && state.bvx > 0){
      state.bx = bX - ballS - 1;
      state.bvx *= -1;

      // bot adds slight “smart” spin
      var center = bY + state.paddleH / 2;
      var offset = (state.by + 8) - center;
      state.bvy += clamp(offset * 0.03 * state.factor, -2.6, 2.6);

      state.bvx *= (1.02 + (state.factor * 0.02));
      state.bvy *= 1.01;

      state.rally += 1;
      state.bestRallyThisMatch = Math.max(state.bestRallyThisMatch, state.rally);

      if(state.rally % 5 === 0){
        speak('Rally ' + state.rally + '. Don’t get comfortable.', 1200);
      }

      maybeRallyInsight();

      trackEvent('cavbot_tennis_return', { by: state.by, rally: state.rally, who: 'cavbot' });
    }

    // score (ball out)
    if(state.bx < -40){
      // bot scores
      logChat(randomFrom(LINES_MISS));
      pointScored('bot');
    }
    if(state.bx > state.w + 40){
      // you score
      pointScored('you');
    }
  }

  function loop(){
    if(!state.running) return;

    updateAI();
    updateBall();
    updateTimer();
    render();

    // added: CavBot “intelligence” while you idle
    maybeIdleSpeak();

    state.raf = requestAnimationFrame(loop);
  }

  // ---- Start / reset ----
  function startMatch(){
    seedDifficulty();
    resize();

    state.match = analytics.tennisMatches + 1;
    state.matchStart = performance.now();
    state.running = true;

    state.you = 0;
    state.bot = 0;

    state.rally = 0;
    state.bestRallyThisMatch = 0;

    // reset restore gate per match
    state.scoredOnce = false;

    // reset “intelligence” counters
    state.lastInputTs = performance.now();
    state.lastIdleSpeakTs = 0;
    state.lastInsightRally = 0;
    state.winStreak = 0;
    state.lossStreak = 0;

    // clean paddle velocity memory
    state.playerVel = 0;
    state.lastPlayerY = null;

    resetPositions('bot');

    logGame('CONTROL ROOM TENNIS · online · match ' + state.match, 'ok');
    logGame('DIFFICULTY · ' + state.tier + ' · factor ' + state.factor.toFixed(2), 'ok');

    var intro = randomFrom(LINES_START);
    logChat(intro);
    speak(intro, 1600);

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

  // ---- Eye tracking (badge pupils follow the ball) ----
  (function initBadgeEyesToBall(){
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

  // ---- Initial boot log ----
  logGame('CONTROL ROOM · ONLINE', 'ok');
  logGame('STACK · CAVCORE · GAME LAYER', 'ok');
  logGame('MODULE · CONTROL ROOM TENNIS', 'ok');
  logGame('ANALYTICS · tennis matches: ' + analytics.tennisMatches + ' · wins: ' + analytics.tennisWins + ' · losses: ' + analytics.tennisLosses, 'ok');
  if(analytics.tennisBestRally){
    logGame('ANALYTICS · best rally: ' + analytics.tennisBestRally, 'ok');
  }

  startDmTypewriter();
  startMatch();

})();