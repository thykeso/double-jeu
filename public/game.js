'use strict';
// DOUBLE JEU — client
const T = 48, RW = 13, RH = 9, RPX = RW * T, RPY = RH * T, REACH = 36;
const ITEM_NAMES = ['Dossier', 'Clé', 'Plans', 'Disque', 'Mallette', 'Passeport', 'Micro-film', 'Lingot', 'Code', 'Carnet'];
const ITEM_EMO = ['📁', '🔑', '🗺️', '💿', '💼', '🛂', '🎞️', '🪙', '🔢', '📓'];
const ITEM_COL = ['#ffd166', '#c9d1d9', '#7aa7ff', '#d58cff', '#ff9f68', '#6ee0c0', '#ff7a9c', '#b4e061', '#6ec1ff', '#f5e6a8'];
const PCOL = ['#38e0d0', '#ff8a3d', '#ff5fa2', '#a6e22e', '#b388ff'];
const ROOM_POOL = [
  'Salle des cartes', 'Bibliothèque', 'Bureau du directeur', 'Archives', 'Salle de contrôle', 'Laboratoire',
  'Salon', 'Quartier général', 'Cuisine', 'Salle des coffres', 'Atelier', 'Infirmerie', 'Garage',
  'Salle de réunion', 'Cave à vin', 'Serre', 'Salle des machines', 'Dortoir', 'Cabinet secret',
  'Vestiaire', 'Salle d’interrogatoire', 'Hall d’entrée', 'Salle radio', 'Armurerie', 'Galerie',
];
const TRAP_COL = ['', '#ff5d5d', '#ffd166', '#6ee07a'];
const TRAP_LET = ['', 'B', 'R', 'C'];

const $ = (id) => document.getElementById(id);
const screens = { menu: $('menu'), wait: $('wait'), lobby: $('lobby'), game: $('game') };
function show(n) { for (const k in screens) screens[k].classList.toggle('on', k === n); }
const gameOn = () => screens.game.classList.contains('on');

// ---------- Réseau ----------
let ws = null, queue = [];
function connect(cb) {
  if (ws && ws.readyState === 1) return cb();
  if (ws && ws.readyState === 0) { queue.push(cb); return; }
  queue = [cb];
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
  ws.onopen = () => { const q = queue; queue = []; q.forEach((f) => f()); };
  ws.onmessage = (e) => { try { onMsg(JSON.parse(e.data)); } catch (err) { console.error(err); } };
  ws.onclose = () => {
    L = null;
    if (gameOn() && G && !G.over) endOverlay('Connexion perdue', 'Le serveur ne répond plus.', false);
    else if (!screens.menu.classList.contains('on')) { show('menu'); setErr('Connexion perdue.'); }
  };
}
function send(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }
function setErr(m) { $('err').textContent = m || ''; }
function pname() { const v = $('name').value.trim(); try { localStorage.setItem('dj_name', v); } catch (e) {} return v || 'Agent'; }
try { $('name').value = localStorage.getItem('dj_name') || ''; } catch (e) {}

$('bBot').onclick = () => { setErr(''); connect(() => send({ t: 'create', name: pname(), bots: 1 })); };
$('bQuick').onclick = () => { setErr(''); connect(() => send({ t: 'quick', name: pname() })); };
$('bCreate').onclick = () => { setErr(''); connect(() => send({ t: 'create', name: pname() })); };
$('bJoin').onclick = () => {
  const c = $('code').value.trim().toUpperCase();
  if (c.length !== 4) return setErr('Le code a 4 lettres.');
  setErr(''); connect(() => send({ t: 'join', code: c, name: pname() }));
};
$('code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('bJoin').click(); });
$('bCancel').onclick = () => { send({ t: 'leave' }); show('menu'); };
$('bLeave').onclick = () => { send({ t: 'leave' }); L = null; show('menu'); };
$('bAddBot').onclick = () => send({ t: 'addbot' });
$('bStart').onclick = () => { $('lMsg').textContent = ''; send({ t: 'start' }); };
$('bCopy').onclick = () => {
  const url = location.origin + location.pathname + '#' + (L ? L.code : '');
  (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(
    () => { $('bCopy').textContent = 'Lien copié !'; setTimeout(() => { $('bCopy').textContent = 'Copier le lien d’invitation'; }, 1800); },
    () => { prompt('Copie ce lien :', url); });
};
if (/^#[A-Za-z]{4}$/.test(location.hash)) $('code').value = location.hash.slice(1).toUpperCase();

// paramètres (hôte uniquement)
$('sItems').addEventListener('input', () => { $('vItems').textContent = $('sItems').value; });
$('sItems').addEventListener('change', () => send({ t: 'cfg', items: +$('sItems').value }));
$('sMap').addEventListener('change', () => send({ t: 'cfg', map: $('sMap').value }));
$('sTime').addEventListener('change', () => send({ t: 'cfg', time: +$('sTime').value }));
$('sPlayers').addEventListener('change', () => send({ t: 'cfg', players: +$('sPlayers').value }));

// ---------- Salon ----------
let L = null; // dernier état du salon
function setVal(el, v) { if (document.activeElement !== el) el.value = String(v); }

function renderLobby() {
  if (!L) return;
  const c = L.cfg, host = L.host;
  $('lCode').textContent = L.code;
  $('lCount').textContent = `(${L.members.length}/${c.players})`;
  const ul = $('plist'); ul.innerHTML = '';
  L.members.forEach((m, i) => {
    const li = document.createElement('li'); li.className = 'pl-row';
    const dot = document.createElement('i'); dot.className = 'dot'; dot.style.background = PCOL[i];
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = m.n;
    li.append(dot, nm);
    const tag = (txt, cls) => { const s = document.createElement('span'); s.className = 'tagb ' + cls; s.textContent = txt; li.append(s); };
    if (m.h) tag('Hôte', 'host');
    if (m.b) tag('Bot', 'bot');
    if (i === L.you) tag('Toi', 'me');
    if (host && i !== L.you) {
      const x = document.createElement('button'); x.className = 'x'; x.textContent = '✕';
      x.title = m.b ? 'Retirer ce bot' : 'Exclure ce joueur';
      x.onclick = () => send({ t: 'kick', i });
      li.append(x);
    }
    ul.append(li);
  });
  for (let i = L.members.length; i < c.players; i++) {
    const li = document.createElement('li'); li.className = 'pl-row empty';
    li.textContent = 'Place libre — en attente d’un joueur…';
    ul.append(li);
  }
  setVal($('sItems'), c.items); $('vItems').textContent = c.items;
  setVal($('sMap'), c.map); setVal($('sTime'), c.time); setVal($('sPlayers'), c.players);
  for (const o of $('sPlayers').options) o.disabled = +o.value < L.members.length;
  for (const id of ['sItems', 'sMap', 'sTime', 'sPlayers']) $(id).disabled = !host;
  $('bAddBot').style.display = host ? '' : 'none';
  $('bAddBot').disabled = L.members.length >= c.players;
  $('bAddBot').title = L.members.length >= c.players ? 'Salon plein : augmente le nombre de joueurs' : '';
  $('bStart').style.display = host ? '' : 'none';
  $('bStart').disabled = L.members.length < 2;
  $('lWaitHost').style.display = host ? 'none' : '';
  $('lHostNote').textContent = host ? '(tu es l’hôte)' : '(réglés par l’hôte)';
  if (host && L.members.length < 2) $('lMsg').textContent = 'Ajoute un bot ou invite un ami pour pouvoir jouer.';
  else if ($('lMsg').textContent.startsWith('Ajoute un bot')) $('lMsg').textContent = '';
}

function onMsg(m) {
  switch (m.t) {
    case 'wait': show('wait'); break;
    case 'lobby':
      L = m;
      renderLobby();
      // on ne ramène pas un joueur du jeu (ou de l'écran de fin) au salon sans qu'il le demande
      if (!gameOn()) show('lobby');
      break;
    case 'err': setErr(m.m); show('menu'); break;
    case 'err2': $('lMsg').textContent = m.m; break;
    case 'kicked': L = null; show('menu'); setErr('Tu as été exclu du salon par l’hôte.'); break;
    case 'start': startGame(m); break;
    case 'go': audio.play('go'); toast('GO !', 'good'); break;
    case 's': onSnap(m); break;
    case 'ev':
      if (m.m) toast(m.m, m.k);
      if (m.snd) audio.play(m.snd);
      if (m.k === 'noise') toast('Un bruit sourd résonne dans le bâtiment…', 'warn');
      break;
    case 'over': onOver(m); break;
  }
}

// ---------- État du jeu ----------
let G = null;
const cv = $('cv'), ctx = cv.getContext('2d');
const mini = $('mini'), mctx = mini.getContext('2d');
const DPR = Math.min(2, window.devicePixelRatio || 1);
cv.width = 624 * DPR; cv.height = 432 * DPR;
mini.width = 116 * DPR; mini.height = 116 * DPR;

function startGame(m) {
  const names = m.names;
  const rn = []; let k = 0;
  const exitRoom = m.exit[0] + m.exit[1] * m.gx;
  for (let i = 0; i < m.gx * m.gy; i++) rn.push(i === exitRoom ? 'HÉLIPORT' : ROOM_POOL[k++ % ROOM_POOL.length]);
  G = {
    you: m.you, names, furn: m.layout, gx: m.gx, gy: m.gy, exitRoom, nItems: m.items, dur: m.dur, roomNames: rn,
    phase: 'count', me: null, ops: [], rx: 0, ry: 0, sm: {}, myItems: [], ic: names.map(() => 0), gn: names.map(() => 0),
    tm: m.dur, cd: 0, fstate: {}, visited: new Set(), last: null, tcd: 0, acd: 0, ch: 3, over: false,
  };
  $('nMe').textContent = names[m.you]; $('nMe').style.color = PCOL[m.you];
  $('overlay').className = ''; $('overlay').innerHTML = '';
  $('log').innerHTML = '';
  buildSlots(); buildScore();
  show('game');
  keys.clear(); lastIn = '';
  audio.init();
}

function buildSlots() {
  const el = $('sMe'); el.innerHTML = '';
  for (let i = 0; i < G.nItems; i++) { const d = document.createElement('div'); d.className = 'slot'; d.textContent = '·'; el.appendChild(d); }
}
function updateSlots() {
  const sl = $('sMe').children;
  for (let i = 0; i < sl.length; i++) {
    const it = G.myItems[i];
    sl[i].className = 'slot' + (it !== undefined ? ' f' : '');
    sl[i].style.background = it !== undefined ? ITEM_COL[it] + '33' : '';
    sl[i].style.borderColor = it !== undefined ? ITEM_COL[it] : '';
    sl[i].textContent = it !== undefined ? ITEM_EMO[it] : '·';
    sl[i].title = it !== undefined ? ITEM_NAMES[it] : '';
  }
}
function buildScore() {
  const el = $('score'); el.innerHTML = '';
  G.names.forEach((n, i) => {
    if (i === G.you) return;
    const c = document.createElement('div'); c.className = 'chip'; c.id = 'chip' + i;
    const d = document.createElement('i'); d.style.background = PCOL[i];
    const s = document.createElement('span'); s.textContent = n;
    const b = document.createElement('b'); b.textContent = '0/' + G.nItems;
    c.append(d, s, b); el.appendChild(c);
  });
}
function updateScore() {
  G.names.forEach((n, i) => {
    if (i === G.you) return;
    const c = $('chip' + i); if (!c) return;
    c.classList.toggle('gone', !!G.gn[i]);
    c.querySelector('b').textContent = G.ic[i] + '/' + G.nItems;
  });
}

function onSnap(s) {
  if (!G || G.over) return;
  G.phase = s.ph; G.tm = s.tm; G.cd = s.cd;
  const first = !G.me;
  G.me = s.me; G.ops = s.ops || []; G.ic = s.ic; G.gn = s.gn; G.myItems = s.me.it;
  G.ch = s.me.ch; G.tcd = s.me.tcd; G.acd = s.me.acd; G.snapAt = performance.now();
  if (first) { G.rx = s.me.x; G.ry = s.me.y; }
  const seen = {};
  for (const o of G.ops) {
    seen[o.i] = 1;
    if (!G.sm[o.i]) G.sm[o.i] = { x: o.x, y: o.y };
  }
  for (const k in G.sm) if (!seen[k]) delete G.sm[k];
  G.fstate = {};
  for (const [id, searched, trap] of s.fs) G.fstate[id] = { searched, trap };
  G.visited.add(Math.floor(s.me.x / RPX) + Math.floor(s.me.y / RPY) * G.gx);
  updateSlots(); updateScore();
  const tt = Math.ceil(s.tm / 1000);
  const t = $('timer'); t.textContent = Math.floor(tt / 60) + ':' + String(tt % 60).padStart(2, '0');
  t.classList.toggle('low', s.ph === 'play' && tt <= 30);
  $('ch').textContent = G.ch;
}

function onOver(m) {
  if (!G) return;
  G.over = true; G.phase = 'over';
  const w = m.w || [];
  const mine = w.includes(G.you);
  let big, color, sub;
  if (mine && w.length === 1) { big = 'VICTOIRE'; color = 'var(--good)'; }
  else if (mine) { big = 'ÉGALITÉ'; color = 'var(--warn)'; }
  else { big = 'DÉFAITE'; color = 'var(--bad)'; }
  const wn = w.map((i) => G.names[i]).join(' et ');
  if (m.reason === 'extraction') sub = mine ? 'Tu t’es envolé avec tous les objets !' : `${wn} s’est envolé avec tous les objets.`;
  else if (m.reason === 'forfait') sub = mine ? 'Tous les autres joueurs ont abandonné.' : `${wn} gagne par forfait.`;
  else if (mine && w.length === 1) sub = 'Temps écoulé : tu as le plus d’objets.';
  else if (mine) sub = `Temps écoulé : égalité avec ${w.filter((i) => i !== G.you).map((i) => G.names[i]).join(', ')}.`;
  else sub = `Temps écoulé : ${wn} a le plus d’objets.`;
  audio.play(mine && w.length === 1 ? 'win' : mine ? 'tick' : 'lose');
  const order = G.names.map((n, i) => i).sort((a, b) => (m.n[b] - m.n[a]) || (w.includes(b) - w.includes(a)));
  endOverlay(big, sub, true, color, order, m.n);
}

function endOverlay(big, sub, back, color, order, counts) {
  const o = $('overlay');
  o.className = 'on'; o.innerHTML = '';
  const a = document.createElement('div'); a.className = 'big'; a.textContent = big; if (color) a.style.color = color;
  const p = document.createElement('p'); p.textContent = sub;
  o.append(a, p);
  if (order) {
    const ol = document.createElement('ol');
    order.forEach((i, r) => {
      const li = document.createElement('li');
      const d = document.createElement('i'); d.style.cssText = `width:10px;height:10px;border-radius:50%;background:${PCOL[i]}`;
      const s = document.createElement('span'); s.textContent = `${r + 1}. ${G.names[i]}${i === G.you ? ' (toi)' : ''} — ${counts[i]}/${G.nItems} objets`;
      li.append(d, s); ol.appendChild(li);
    });
    o.appendChild(ol);
  }
  const r = document.createElement('div'); r.className = 'row'; r.style.justifyContent = 'center';
  if (back) {
    const b = document.createElement('button'); b.className = 'primary'; b.textContent = 'Retour au salon';
    b.onclick = () => { send({ t: 'back' }); if (L) { renderLobby(); show('lobby'); } };
    r.appendChild(b);
  }
  const q = document.createElement('button'); q.textContent = 'Menu';
  q.onclick = () => { send({ t: 'leave' }); L = null; G = null; show('menu'); };
  r.appendChild(q);
  o.appendChild(r);
}

function toast(msg, kind) {
  const log = $('log');
  const d = document.createElement('div'); d.className = kind || 'info'; d.textContent = msg;
  log.appendChild(d);
  while (log.children.length > 4) log.removeChild(log.firstChild);
  setTimeout(() => d.remove(), 4200);
}

// ---------- Entrées ----------
const keys = new Set();
let lastIn = '';
const MOVE = { z: [0, -1], w: [0, -1], arrowup: [0, -1], s: [0, 1], arrowdown: [0, 1], q: [-1, 0], a: [-1, 0], arrowleft: [-1, 0], d: [1, 0], arrowright: [1, 0] };
function pushInput(force) {
  let x = 0, y = 0;
  for (const k of keys) if (MOVE[k]) { x += MOVE[k][0]; y += MOVE[k][1]; }
  x = Math.sign(x); y = Math.sign(y);
  const s = x + ',' + y;
  if (s !== lastIn || force) { lastIn = s; send({ t: 'in', x, y }); }
}
function act(k) { if (G && !G.over) send({ t: 'a', k }); }
function quitGame() {
  if (G && !G.over && !confirm('Quitter la partie en cours ?')) return;
  send({ t: 'leave' }); L = null; G = null; show('menu');
}
window.addEventListener('keydown', (e) => {
  if (!G || !gameOn() || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  const k = e.key.toLowerCase();
  if (MOVE[k] || k === ' ') e.preventDefault();
  if (MOVE[k]) { keys.add(k); pushInput(); return; }
  if (e.repeat) return;
  if (k === 'e' || k === 'enter') act('e');
  else if (k === 'r') act('r');
  else if (k === ' ') act('atk');
  else if (k === '1' || k === '&') act(1);
  else if (k === '2' || k === 'é') act(2);
  else if (k === '3' || k === '"') act(3);
});
window.addEventListener('keyup', (e) => { keys.delete(e.key.toLowerCase()); if (G && gameOn()) pushInput(); });
window.addEventListener('blur', () => { keys.clear(); if (G && gameOn()) pushInput(); });
setInterval(() => { if (G && !G.over && gameOn()) pushInput(true); }, 250);
document.querySelectorAll('#bar .btn').forEach((b) => {
  b.addEventListener('click', () => { const k = b.dataset.k; if (k === 'quit') quitGame(); else act(/^[123]$/.test(k) ? +k : k); });
});

// ---------- Son ----------
const audio = {
  c: null,
  init() { if (!this.c) { try { this.c = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} } if (this.c && this.c.state === 'suspended') this.c.resume(); },
  tone(f, d, type, v, when, slide) {
    if (!this.c) return;
    const t = this.c.currentTime + (when || 0), o = this.c.createOscillator(), g = this.c.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(f, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + d);
    g.gain.setValueAtTime(v || 0.06, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g).connect(this.c.destination); o.start(t); o.stop(t + d + 0.02);
  },
  noise(d, v) {
    if (!this.c) return;
    const n = this.c.sampleRate * d, b = this.c.createBuffer(1, n, this.c.sampleRate), a = b.getChannelData(0);
    for (let i = 0; i < n; i++) a[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = this.c.createBufferSource(), g = this.c.createGain(); g.gain.value = v || 0.2;
    s.buffer = b; s.connect(g).connect(this.c.destination); s.start();
  },
  play(n) {
    switch (n) {
      case 'tick': this.tone(300, 0.06, 'square', 0.03); break;
      case 'find': this.tone(660, 0.1, 'triangle', 0.08); this.tone(990, 0.18, 'triangle', 0.08, 0.1); break;
      case 'boom': this.noise(0.6, 0.35); this.tone(90, 0.5, 'sawtooth', 0.12, 0, 30); break;
      case 'boing': this.tone(200, 0.35, 'sine', 0.12, 0, 700); break;
      case 'splat': this.noise(0.2, 0.12); this.tone(160, 0.2, 'sine', 0.08, 0, 60); break;
      case 'hit': this.tone(140, 0.12, 'square', 0.09, 0, 70); break;
      case 'set': this.tone(420, 0.05, 'square', 0.04); this.tone(320, 0.07, 'square', 0.04, 0.05); break;
      case 'defuse': this.tone(520, 0.08, 'triangle', 0.07); this.tone(780, 0.12, 'triangle', 0.07, 0.08); break;
      case 'trap': this.tone(880, 0.1, 'square', 0.05); this.tone(1175, 0.16, 'square', 0.05, 0.1); break;
      case 'noise': this.noise(0.25, 0.08); break;
      case 'go': this.tone(523, 0.12, 'square', 0.06); this.tone(784, 0.25, 'square', 0.06, 0.12); break;
      case 'win': [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.2, 'triangle', 0.08, i * 0.13)); break;
      case 'lose': [400, 330, 262, 196].forEach((f, i) => this.tone(f, 0.25, 'sawtooth', 0.06, i * 0.15)); break;
    }
  },
};

// ---------- Rendu ----------
function isWallTile(wx, wy) {
  const rx = Math.floor(wx / RW), ry = Math.floor(wy / RH), lx = wx % RW, ly = wy % RH;
  const eX = lx === 0 || lx === RW - 1, eY = ly === 0 || ly === RH - 1;
  if (!eX && !eY) return false;
  if (eX && eY) return true;
  if (eY) return !(lx === 6 && (ly === 0 ? ry > 0 : ry < G.gy - 1));
  return !(ly === 4 && (lx === 0 ? rx > 0 : rx < G.gx - 1));
}
const roomHue = (i) => (200 + i * 47) % 360;

function rr(c, x, y, w, h, r) { c.beginPath(); c.roundRect ? c.roundRect(x, y, w, h, r) : c.rect(x, y, w, h); }

function drawFloor(room) {
  const rx = room % G.gx, ry = Math.floor(room / G.gx), hue = roomHue(room);
  for (let ly = 0; ly < RH; ly++) for (let lx = 0; lx < RW; lx++) {
    const wx = rx * RW + lx, wy = ry * RH + ly, x = wx * T, y = wy * T;
    if (isWallTile(wx, wy)) {
      ctx.fillStyle = '#262c3c'; ctx.fillRect(x, y, T, T);
      ctx.fillStyle = '#323a50'; ctx.fillRect(x, y, T, 5);
      ctx.fillStyle = '#1b2030'; ctx.fillRect(x, y + T - 6, T, 6);
    } else {
      const door = lx === 0 || ly === 0 || lx === RW - 1 || ly === RH - 1;
      ctx.fillStyle = door ? `hsl(${hue},18%,14%)` : (lx + ly) % 2 ? `hsl(${hue},22%,23%)` : `hsl(${hue},22%,21%)`;
      ctx.fillRect(x, y, T, T);
      if (door) { ctx.fillStyle = 'rgba(255,214,102,.14)'; ctx.fillRect(x + 4, y + 4, T - 8, T - 8); }
    }
  }
  ctx.fillStyle = `hsla(${hue},40%,40%,.10)`;
  ctx.fillRect((rx * RW + 3) * T, (ry * RH + 2) * T, 7 * T, 5 * T);
}

function drawHelipad(room, t) {
  const cx = ((room % G.gx) * RW + 6.5) * T, cy = (Math.floor(room / G.gx) * RH + 4.5) * T;
  const ready = G.myItems.length >= G.nItems;
  ctx.save(); ctx.translate(cx, cy);
  ctx.fillStyle = '#1a1d27'; ctx.beginPath(); ctx.arc(0, 0, 74, 0, 7); ctx.fill();
  ctx.lineWidth = 5; ctx.strokeStyle = ready ? `rgba(110,224,122,${0.6 + 0.4 * Math.sin(t / 180)})` : '#ffd166';
  ctx.beginPath(); ctx.arc(0, 0, 62, 0, 7); ctx.stroke();
  ctx.fillStyle = ctx.strokeStyle; ctx.font = '800 56px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('H', 0, 3);
  ctx.restore();
}

const FCOL = [
  ['#8b5a2b', '#a9713a'], ['#5b3d28', '#76503a'], ['#9a6b3e', '#b98550'],
  ['#4c3a2d', '#654c3a'], ['#4a5568', '#667189'], ['#5a4f7a', '#7367a0'],
];
function drawFurn(f, nearId, t) {
  const x = f.x * T, y = f.y * T, w = f.w * T, h = T;
  const st = G.fstate[f.id] || { searched: 0, trap: 0 };
  const [dark, light] = FCOL[f.type];
  ctx.fillStyle = 'rgba(0,0,0,.35)'; rr(ctx, x + 3, y + 6, w - 2, h - 2, 6); ctx.fill();
  ctx.fillStyle = dark; rr(ctx, x + 2, y + 2, w - 4, h - 4, 6); ctx.fill();
  ctx.fillStyle = light; rr(ctx, x + 4, y + 4, w - 8, h - 14, 5); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 2;
  switch (f.type) {
    case 0:
      for (let i = 0; i < 2; i++) { ctx.strokeRect(x + 8 + i * (w / 2 - 6), y + h - 18, w / 2 - 14, 8); }
      ctx.fillStyle = '#2d6a4f'; ctx.fillRect(x + w / 2 - 12, y + 9, 24, 12); break;
    case 1:
      ctx.beginPath(); ctx.moveTo(x + w / 2, y + 5); ctx.lineTo(x + w / 2, y + h - 9); ctx.stroke();
      ctx.fillStyle = '#e8d8a0'; ctx.fillRect(x + w / 2 - 6, y + 20, 3, 6); ctx.fillRect(x + w / 2 + 3, y + 20, 3, 6); break;
    case 2:
      for (let i = 0; i < 3; i++) { ctx.strokeRect(x + 8 + i * (w - 16) / 3, y + 8, (w - 16) / 3 - 4, 18); }
      break;
    case 3: {
      const cols = ['#c0392b', '#2980b9', '#27ae60', '#f1c40f', '#8e44ad', '#e67e22'];
      for (let i = 0; i < w / 8 - 1; i++) { ctx.fillStyle = cols[i % 6]; ctx.fillRect(x + 8 + i * 8, y + 8 + (i % 3) * 2, 6, 20 - (i % 3) * 2); }
      break; }
    case 4:
      ctx.strokeStyle = '#aab4c8'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x + w / 2, y + h / 2 - 3, 11, 0, 7); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + w / 2, y + h / 2 - 3); ctx.lineTo(x + w / 2 + 8, y + h / 2 - 8); ctx.stroke(); break;
    case 5:
      ctx.fillStyle = '#e8e8f0'; rr(ctx, x + 6, y + 7, 24, 22, 5); ctx.fill();
      ctx.fillStyle = '#7a8bd1'; ctx.fillRect(x + 34, y + 6, w - 42, 24); break;
  }
  if (st.searched) { ctx.fillStyle = 'rgba(8,10,16,.45)'; rr(ctx, x + 2, y + 2, w - 4, h - 4, 6); ctx.fill(); }
  if (st.trap) {
    ctx.fillStyle = TRAP_COL[st.trap]; ctx.beginPath(); ctx.arc(x + w - 11, y + 11, 9, 0, 7); ctx.fill();
    ctx.fillStyle = '#10131b'; ctx.font = '800 12px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(TRAP_LET[st.trap], x + w - 11, y + 12);
  }
  if (nearId === f.id) {
    ctx.strokeStyle = `rgba(255,255,255,${0.55 + 0.25 * Math.sin(t / 140)})`; ctx.lineWidth = 2;
    rr(ctx, x - 1, y - 1, w + 2, h + 2, 8); ctx.stroke();
  }
}

function drawAgent(x, y, fx, fy, col, name, st, t, isMe) {
  ctx.save(); ctx.translate(x, y);
  if (st.slw) { ctx.fillStyle = 'rgba(110,224,122,.35)'; ctx.beginPath(); ctx.ellipse(0, 12, 20, 9, 0, 0, 7); ctx.fill(); }
  ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(0, 13, 14, 6, 0, 0, 7); ctx.fill();
  if (st.imm && !st.stn && Math.floor(t / 90) % 2) ctx.globalAlpha = 0.5;
  ctx.rotate((st.stn ? 0.9 : 0) * Math.sin(t / 90) * 0.15);
  ctx.fillStyle = col; rr(ctx, -12, -2, 24, 18, 8); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(-1, 2, 2, 14);
  ctx.fillStyle = '#f2d2b0'; ctx.beginPath(); ctx.arc(0, -8, 10, 0, 7); ctx.fill();
  ctx.fillStyle = '#14171f'; ctx.fillRect(-13, -14, 26, 4); rr(ctx, -8, -23, 16, 11, 3); ctx.fill();
  ctx.fillStyle = col; ctx.fillRect(-8, -15, 16, 2);
  const ox = Math.max(-1, Math.min(1, fx)) * 2.5, oy = Math.max(-1, Math.min(1, fy)) * 1.5;
  ctx.fillStyle = '#0a0c12'; ctx.fillRect(-8 + ox, -9 + oy, 16, 5);
  ctx.fillStyle = '#fff'; ctx.fillRect(-5 + ox, -8 + oy, 3, 2); ctx.fillRect(2 + ox, -8 + oy, 3, 2);
  if (st.swg) {
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(fx * 10, fy * 10); ctx.lineTo(fx * 40, fy * 40); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  if (st.stn) {
    ctx.fillStyle = '#ffd166'; ctx.font = '700 14px system-ui'; ctx.textAlign = 'center';
    for (let i = 0; i < 3; i++) { const a = t / 200 + i * 2.1; ctx.fillText('★', Math.cos(a) * 15, -26 + Math.sin(a) * 4); }
  }
  ctx.restore();
  ctx.font = '600 11px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillText(name, x + 1, y - 33);
  ctx.fillStyle = isMe ? '#fff' : col; ctx.fillText(name, x, y - 34);
  if (st.act && st.act.k !== 'swing') {
    const w = 36;
    ctx.fillStyle = 'rgba(0,0,0,.65)'; ctx.fillRect(x - w / 2, y - 46, w, 6);
    ctx.fillStyle = st.act.k === 'extract' ? '#6ee07a' : st.act.k === 'defuse' ? '#7aa7ff' : st.act.k === 'place' ? '#ff5d5d' : '#ffd166';
    ctx.fillRect(x - w / 2 + 1, y - 45, (w - 2) * st.act.p, 4);
  }
}

function nearestFurnClient(px, py) {
  let best = null, bd = REACH;
  for (const f of G.furn) {
    const x0 = f.x * T, y0 = f.y * T, x1 = x0 + f.w * T, y1 = y0 + T;
    const dx = Math.max(x0 - px, 0, px - x1), dy = Math.max(y0 - py, 0, py - y1), d = Math.hypot(dx, dy);
    if (d <= bd) { bd = d; best = f; }
  }
  return best;
}

function frame(t) {
  requestAnimationFrame(frame);
  if (!G || !G.me || !gameOn()) return;
  const dt = G.last ? Math.min(0.1, (t - G.last) / 1000) : 0.016; G.last = t;
  const k = 1 - Math.pow(0.0004, dt);
  G.rx += (G.me.x - G.rx) * k; G.ry += (G.me.y - G.ry) * k;
  for (const o of G.ops) { const s = G.sm[o.i]; s.x += (o.x - s.x) * k; s.y += (o.y - s.y) * k; }
  const room = Math.floor(G.me.x / RPX) + Math.floor(G.me.y / RPY) * G.gx;
  const rx = room % G.gx, ry = Math.floor(room / G.gx);

  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = '#05070b'; ctx.fillRect(0, 0, 624, 432);
  ctx.save(); ctx.translate(-rx * RPX, -ry * RPY);
  drawFloor(room);
  if (room === G.exitRoom) drawHelipad(room, t);
  const near = nearestFurnClient(G.me.x, G.me.y);
  const nearId = near && !G.me.stn ? near.id : -1;
  for (const f of G.furn) if (f.x >= rx * RW && f.x < (rx + 1) * RW && f.y >= ry * RH && f.y < (ry + 1) * RH) drawFurn(f, nearId, t);
  const list = [{ y: G.ry, fn: () => drawAgent(G.rx, G.ry, G.me.fx, G.me.fy, PCOL[G.you], G.names[G.you], G.me, t, true) }];
  for (const o of G.ops) { const s = G.sm[o.i]; list.push({ y: s.y, fn: () => drawAgent(s.x, s.y, o.fx, o.fy, PCOL[o.i], G.names[o.i], o, t, false) }); }
  list.sort((a, b) => a.y - b.y).forEach((o) => o.fn());
  ctx.restore();

  ctx.font = '700 12px system-ui,sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  const rname = G.roomNames[room];
  ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(8, 8, ctx.measureText(rname).width + 16, 22);
  ctx.fillStyle = '#e8ecf5'; ctx.fillText(rname, 16, 23);
  const g = ctx.createRadialGradient(312, 216, 150, 312, 216, 400);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.45)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 624, 432);
  if (G.me.stn) { ctx.fillStyle = 'rgba(255,93,93,.14)'; ctx.fillRect(0, 0, 624, 432); }

  if (G.phase === 'count') {
    const n = Math.ceil(G.cd / 1000);
    ctx.fillStyle = 'rgba(5,7,11,.55)'; ctx.fillRect(0, 0, 624, 432);
    ctx.fillStyle = '#fff'; ctx.font = '800 96px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(n > 3 ? 'PRÊT ?' : String(Math.max(1, n)), 312, 200);
    ctx.font = '600 16px system-ui,sans-serif'; ctx.fillStyle = '#c6cce0';
    ctx.fillText(`Trouve ${G.nItems > 1 ? 'les ' + G.nItems + ' objets' : 'l’objet'} et file à l’hélico.`, 312, 270);
  }
  drawMini(room);
  updateBar();
}

function drawMini(room) {
  const c = mctx;
  c.setTransform(DPR, 0, 0, DPR, 0, 0);
  c.clearRect(0, 0, 116, 116);
  const gx = G.gx, gy = G.gy, pad = 7, gap = 2;
  const cell = Math.floor((116 - pad * 2 - gap * (Math.max(gx, gy) - 1)) / Math.max(gx, gy));
  const ox = (116 - (gx * cell + (gx - 1) * gap)) / 2, oy = (116 - (gy * cell + (gy - 1) * gap)) / 2;
  for (let i = 0; i < gx * gy; i++) {
    const x = ox + (i % gx) * (cell + gap), y = oy + Math.floor(i / gx) * (cell + gap);
    c.fillStyle = G.visited.has(i) ? `hsl(${roomHue(i)},30%,26%)` : '#171b26';
    c.fillRect(x, y, cell, cell);
    if (i === G.exitRoom) { c.fillStyle = '#ffd166'; c.font = `800 ${Math.max(10, cell * 0.5)}px system-ui`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('H', x + cell / 2, y + cell / 2 + 1); }
    if (i === room) {
      c.strokeStyle = PCOL[G.you]; c.lineWidth = 2; c.strokeRect(x + 1, y + 1, cell - 2, cell - 2);
      c.fillStyle = PCOL[G.you]; c.beginPath(); c.arc(x + cell / 2, y + cell / 2 + (i === G.exitRoom ? cell * 0.3 : 0), Math.max(2.5, cell * 0.12), 0, 7); c.fill();
    }
  }
}

function updateBar() {
  const cdFrac = (ms, tot) => Math.min(1, ms / tot);
  const age = G.snapAt ? performance.now() - G.snapAt : 0;
  const tcd = Math.max(0, G.tcd - age), acd = Math.max(0, G.acd - age);
  for (const b of $('bar').children) {
    const k = b.dataset.k, bar = b.querySelector('i');
    let dis = false, f = 0;
    if (/^[123]$/.test(k)) { dis = tcd > 0; f = cdFrac(tcd, 3500); }
    else if (k === 'atk') { dis = acd > 0; f = cdFrac(acd, 800); }
    else if (k === 'r') dis = G.ch <= 0;
    b.classList.toggle('dis', dis);
    if (bar) bar.style.width = (f * 100) + '%';
  }
}
requestAnimationFrame(frame);
