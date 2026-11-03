'use strict';
// DOUBLE JEU — client
const T = 48, RW = 13, RH = 9, GX = 3, GY = 3, RPX = RW * T, RPY = RH * T, REACH = 36;
const ITEMS = ['Dossier', 'Clé', 'Plans', 'Disque'];
const ITEM_COL = ['#ffd166', '#c9d1d9', '#7aa7ff', '#d58cff'];
const ITEM_ICO = ['D', 'C', 'P', 'M'];
const FNAMES = ['bureau', 'armoire', 'commode', 'bibliothèque', 'coffre', 'lit'];
const ROOM_NAMES = [
  'Salle des cartes', 'Bibliothèque', 'Bureau du directeur',
  'Archives', 'HÉLIPORT', 'Salle de contrôle',
  'Laboratoire', 'Salon', 'Quartier général',
];
const TRAP_COL = ['', '#ff5d5d', '#ffd166', '#6ee07a'];
const TRAP_LET = ['', 'B', 'R', 'C'];
const COL_ME = '#38e0d0', COL_OP = '#ff8a3d';

const $ = (id) => document.getElementById(id);
const screens = { menu: $('menu'), wait: $('wait'), game: $('game') };
function show(n) { for (const k in screens) screens[k].classList.toggle('on', k === n); }

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
    if (screens.game.classList.contains('on') && G && G.phase !== 'over') endOverlay('Connexion perdue', 'Le serveur ne répond plus.', false);
    else if (!screens.menu.classList.contains('on')) { show('menu'); setErr('Connexion perdue.'); }
  };
}
function send(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }
function setErr(m) { $('err').textContent = m || ''; }
function pname() { const v = $('name').value.trim(); try { localStorage.setItem('dj_name', v); } catch (e) {} return v || 'Agent'; }
try { $('name').value = localStorage.getItem('dj_name') || ''; } catch (e) {}

$('bQuick').onclick = () => { setErr(''); connect(() => send({ t: 'quick', name: pname() })); };
$('bCreate').onclick = () => { setErr(''); connect(() => send({ t: 'create', name: pname() })); };
$('bJoin').onclick = () => {
  const c = $('code').value.trim().toUpperCase();
  if (c.length !== 4) return setErr('Le code a 4 lettres.');
  setErr(''); connect(() => send({ t: 'join', code: c, name: pname() }));
};
$('code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('bJoin').click(); });
$('bCancel').onclick = () => { send({ t: 'leave' }); show('menu'); };
$('bCopy').onclick = () => {
  const url = location.origin + location.pathname + '#' + (waitCode || '');
  (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(
    () => { $('bCopy').textContent = 'Lien copié !'; setTimeout(() => { $('bCopy').textContent = 'Copier le lien d’invitation'; }, 1800); },
    () => { prompt('Copie ce lien :', url); });
};
if (/^#[A-Za-z]{4}$/.test(location.hash)) $('code').value = location.hash.slice(1).toUpperCase();

let waitCode = null;
function onMsg(m) {
  switch (m.t) {
    case 'wait':
      waitCode = m.code;
      $('waitCode').textContent = m.code || '';
      $('waitTxt').textContent = m.code ? 'Salon créé — donne ce code à ton adversaire' : 'Recherche d’un adversaire…';
      $('waitHint').textContent = m.code ? 'Il peut aussi ouvrir le lien d’invitation.' : 'La partie démarre dès qu’un autre joueur clique sur « Partie rapide ».';
      $('bCopy').style.display = m.code ? '' : 'none';
      show('wait');
      break;
    case 'err': setErr(m.m); show('menu'); break;
    case 'notice': toast(m.m, 'warn'); break;
    case 'start': startGame(m); break;
    case 'go': audio.play('go'); toast('GO !', 'good'); break;
    case 's': onSnap(m); break;
    case 'ev': if (m.m) toast(m.m, m.k); if (m.snd) audio.play(m.snd); if (m.k === 'noise') toast('Un bruit sourd résonne dans le bâtiment…', 'warn'); break;
    case 'cancel': break;
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
  G = {
    you: m.you, names: m.names, furn: m.layout, dur: m.dur, phase: 'count',
    me: null, op: null, rx: 0, ry: 0, ox: 0, oy: 0, oInit: false, oi: 0, myItems: [], tm: m.dur, cd: 0,
    fstate: {}, visited: new Set(), last: null, tcd: 0, acd: 0, ch: 3, over: false,
  };
  $('nMe').textContent = m.names[m.you];
  $('nOp').textContent = m.names[1 - m.you];
  $('overlay').className = ''; $('overlay').innerHTML = '';
  $('log').innerHTML = '';
  buildSlots();
  show('game');
  keys.clear(); lastIn = '';
  audio.init();
}

function buildSlots() {
  const mk = (id) => { const el = $(id); el.innerHTML = ''; for (let i = 0; i < 4; i++) { const d = document.createElement('div'); d.className = 'slot'; d.textContent = '·'; el.appendChild(d); } };
  mk('sMe'); mk('sOp');
}
function updateSlots() {
  const me = $('sMe').children;
  for (let i = 0; i < 4; i++) {
    const it = G.myItems[i];
    me[i].className = 'slot' + (it !== undefined ? ' f' : '');
    me[i].style.background = it !== undefined ? ITEM_COL[it] : '';
    me[i].textContent = it !== undefined ? ITEM_ICO[it] : '·';
    me[i].title = it !== undefined ? ITEMS[it] : '';
  }
  const op = $('sOp').children;
  for (let i = 0; i < 4; i++) {
    op[i].className = 'slot' + (i < G.oi ? ' f' : '');
    op[i].style.background = i < G.oi ? COL_OP : '';
    op[i].textContent = i < G.oi ? '★' : '·';
  }
}

function onSnap(s) {
  if (!G || G.over) return;
  G.phase = s.ph; G.tm = s.tm; G.cd = s.cd;
  const first = !G.me;
  G.me = s.me; G.op = s.op; G.oi = s.oi; G.myItems = s.me.it;
  G.ch = s.me.ch; G.tcd = s.me.tcd; G.acd = s.me.acd; G.snapAt = performance.now();
  if (first) { G.rx = s.me.x; G.ry = s.me.y; }
  if (s.op && !G.oInit) { G.ox = s.op.x; G.oy = s.op.y; G.oInit = true; }
  if (!s.op) G.oInit = false;
  G.fstate = {};
  for (const [id, searched, trap] of s.fs) G.fstate[id] = { searched, trap };
  const room = Math.floor(s.me.x / RPX) + Math.floor(s.me.y / RPY) * GX;
  G.visited.add(room);
  updateSlots();
  const tt = Math.ceil(s.tm / 1000);
  const t = $('timer'); t.textContent = Math.floor(tt / 60) + ':' + String(tt % 60).padStart(2, '0');
  t.classList.toggle('low', s.ph === 'play' && tt <= 30);
  $('ch').textContent = G.ch;
}

function onOver(m) {
  if (!G) return;
  G.over = true; G.phase = 'over';
  const w = m.w;
  let big, sub, win = false;
  if (w === -1) { big = 'ÉGALITÉ'; sub = 'Temps écoulé, autant d’objets chacun.'; }
  else if (w === G.you) {
    win = true; big = 'VICTOIRE';
    sub = m.reason === 'extraction' ? 'Tu t’es envolé avec tous les objets !' : m.reason === 'forfait' ? 'Ton adversaire a abandonné.' : 'Temps écoulé : tu as plus d’objets.';
  } else {
    big = 'DÉFAITE';
    sub = m.reason === 'extraction' ? 'L’adversaire s’est envolé avec tous les objets.' : 'Temps écoulé : l’adversaire a plus d’objets.';
  }
  audio.play(win ? 'win' : w === -1 ? 'tick' : 'lose');
  endOverlay(big, sub, true, win ? 'var(--good)' : w === -1 ? 'var(--warn)' : 'var(--bad)');
}

function endOverlay(big, sub, again, color) {
  const o = $('overlay');
  o.className = 'on';
  o.innerHTML = '';
  const a = document.createElement('div'); a.className = 'big'; a.textContent = big; if (color) a.style.color = color;
  const p = document.createElement('p'); p.textContent = sub;
  const r = document.createElement('div'); r.className = 'row'; r.style.justifyContent = 'center';
  if (again) { const b = document.createElement('button'); b.className = 'primary'; b.textContent = 'Rejouer'; b.onclick = () => { send({ t: 'again' }); b.textContent = 'En attente de l’adversaire…'; b.disabled = true; }; r.appendChild(b); }
  const q = document.createElement('button'); q.textContent = 'Menu'; q.onclick = () => { send({ t: 'leave' }); show('menu'); G = null; };
  r.appendChild(q);
  o.append(a, p, r);
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
window.addEventListener('keydown', (e) => {
  if (!G || !screens.game.classList.contains('on') || e.target.tagName === 'INPUT') return;
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
window.addEventListener('keyup', (e) => { keys.delete(e.key.toLowerCase()); if (G) pushInput(); });
window.addEventListener('blur', () => { keys.clear(); if (G) pushInput(); });
setInterval(() => { if (G && !G.over) pushInput(true); }, 250);
document.querySelectorAll('#bar .btn').forEach((b) => {
  b.addEventListener('click', () => { const k = b.dataset.k; act(/^[123]$/.test(k) ? +k : k); });
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
  if (eY) return !(lx === 6 && (ly === 0 ? ry > 0 : ry < GY - 1));
  return !(ly === 4 && (lx === 0 ? rx > 0 : rx < GX - 1));
}
const ROOM_HUE = [210, 160, 28, 275, 195, 340, 120, 50, 12];

function rr(c, x, y, w, h, r) { c.beginPath(); c.roundRect ? c.roundRect(x, y, w, h, r) : c.rect(x, y, w, h); }

function drawFloor(room) {
  const rx = room % GX, ry = Math.floor(room / GX), hue = ROOM_HUE[room];
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
  // tapis central discret
  ctx.fillStyle = `hsla(${hue},40%,40%,.10)`;
  ctx.fillRect((rx * RW + 3) * T, (ry * RH + 2) * T, 7 * T, 5 * T);
}

function drawHelipad(room, t) {
  const cx = (Math.floor(room % GX) * RW + 6.5) * T, cy = (Math.floor(room / GX) * RH + 4.5) * T;
  const ready = G.myItems.length === 4;
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
    case 0: // bureau
      for (let i = 0; i < 2; i++) { ctx.strokeRect(x + 8 + i * (w / 2 - 6), y + h - 18, w / 2 - 14, 8); }
      ctx.fillStyle = '#2d6a4f'; ctx.fillRect(x + w / 2 - 12, y + 9, 24, 12); break;
    case 1: // armoire
      ctx.beginPath(); ctx.moveTo(x + w / 2, y + 5); ctx.lineTo(x + w / 2, y + h - 9); ctx.stroke();
      ctx.fillStyle = '#e8d8a0'; ctx.fillRect(x + w / 2 - 6, y + 20, 3, 6); ctx.fillRect(x + w / 2 + 3, y + 20, 3, 6); break;
    case 2: // commode
      for (let i = 0; i < 3; i++) { ctx.strokeRect(x + 8 + i * (w - 16) / 3, y + 8, (w - 16) / 3 - 4, 18); }
      break;
    case 3: { // bibliothèque
      const cols = ['#c0392b', '#2980b9', '#27ae60', '#f1c40f', '#8e44ad', '#e67e22'];
      for (let i = 0; i < w / 8 - 1; i++) { ctx.fillStyle = cols[i % 6]; ctx.fillRect(x + 8 + i * 8, y + 8 + (i % 3) * 2, 6, 20 - (i % 3) * 2); }
      break; }
    case 4: // coffre-fort
      ctx.strokeStyle = '#aab4c8'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x + w / 2, y + h / 2 - 3, 11, 0, 7); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + w / 2, y + h / 2 - 3); ctx.lineTo(x + w / 2 + 8, y + h / 2 - 8); ctx.stroke(); break;
    case 5: // lit
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
  const lean = st.stn ? 0.9 : 0;
  ctx.rotate(lean * Math.sin(t / 90) * 0.15);
  // manteau
  ctx.fillStyle = col; rr(ctx, -12, -2, 24, 18, 8); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(-1, 2, 2, 14);
  // tête
  ctx.fillStyle = '#f2d2b0'; ctx.beginPath(); ctx.arc(0, -8, 10, 0, 7); ctx.fill();
  // chapeau
  ctx.fillStyle = '#14171f'; ctx.fillRect(-13, -14, 26, 4); rr(ctx, -8, -23, 16, 11, 3); ctx.fill();
  ctx.fillStyle = col; ctx.fillRect(-8, -15, 16, 2);
  // lunettes (direction)
  const ox = Math.max(-1, Math.min(1, fx)) * 2.5, oy = Math.max(-1, Math.min(1, fy)) * 1.5;
  ctx.fillStyle = '#0a0c12'; ctx.fillRect(-8 + ox, -9 + oy, 16, 5);
  ctx.fillStyle = '#fff'; ctx.fillRect(-5 + ox, -8 + oy, 3, 2); ctx.fillRect(2 + ox, -8 + oy, 3, 2);
  if (st.swg) {
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(fx * 10, fy * 10); ctx.lineTo(fx * 40, fy * 40); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  if (st.stn) { // étoiles
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
  if (!G || !G.me || !screens.game.classList.contains('on')) return;
  const dt = G.last ? Math.min(0.1, (t - G.last) / 1000) : 0.016; G.last = t;
  const k = 1 - Math.pow(0.0004, dt); // lissage exponentiel
  G.rx += (G.me.x - G.rx) * k; G.ry += (G.me.y - G.ry) * k;
  if (G.op) { G.ox += (G.op.x - G.ox) * k; G.oy += (G.op.y - G.oy) * k; }
  const room = Math.floor(G.me.x / RPX) + Math.floor(G.me.y / RPY) * GX;
  const rx = room % GX, ry = Math.floor(room / GX);

  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = '#05070b'; ctx.fillRect(0, 0, 624, 432);
  ctx.save(); ctx.translate(-rx * RPX, -ry * RPY);
  drawFloor(room);
  if (room === 4) drawHelipad(room, t);
  const near = nearestFurnClient(G.me.x, G.me.y);
  const nearId = near && !G.me.stn ? near.id : -1;
  for (const f of G.furn) if (f.x >= rx * RW && f.x < (rx + 1) * RW && f.y >= ry * RH && f.y < (ry + 1) * RH) drawFurn(f, nearId, t);
  // agents (tri par y)
  const list = [{ y: G.ry, fn: () => drawAgent(G.rx, G.ry, G.me.fx, G.me.fy, COL_ME, G.names[G.you], G.me, t, true) }];
  if (G.op) list.push({ y: G.oy, fn: () => drawAgent(G.ox, G.oy, G.op.fx, G.op.fy, COL_OP, G.names[1 - G.you], G.op, t, false) });
  list.sort((a, b) => a.y - b.y).forEach((o) => o.fn());
  ctx.restore();

  // nom de la pièce + vignette
  ctx.font = '700 12px system-ui,sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(8, 8, ctx.measureText(ROOM_NAMES[room]).width + 16, 22);
  ctx.fillStyle = '#e8ecf5'; ctx.fillText(ROOM_NAMES[room], 16, 23);
  const g = ctx.createRadialGradient(312, 216, 150, 312, 216, 400);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.45)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 624, 432);
  if (G.me.stn) { ctx.fillStyle = 'rgba(255,93,93,.14)'; ctx.fillRect(0, 0, 624, 432); }

  // compte à rebours
  if (G.phase === 'count') {
    const n = Math.ceil(G.cd / 1000);
    ctx.fillStyle = 'rgba(5,7,11,.55)'; ctx.fillRect(0, 0, 624, 432);
    ctx.fillStyle = '#fff'; ctx.font = '800 96px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(n > 3 ? 'PRÊT ?' : String(Math.max(1, n)), 312, 200);
    ctx.font = '600 16px system-ui,sans-serif'; ctx.fillStyle = '#c6cce0';
    ctx.fillText('Fouille, piège, assomme — et file à l’hélico.', 312, 270);
  }
  drawMini();
  updateBar();
}

function drawMini() {
  const c = mctx, S = 116 * DPR;
  c.setTransform(DPR, 0, 0, DPR, 0, 0);
  c.clearRect(0, 0, 116, 116);
  const cell = 34, pad = 7;
  const room = Math.floor(G.me.x / RPX) + Math.floor(G.me.y / RPY) * GX;
  for (let i = 0; i < 9; i++) {
    const x = pad + (i % GX) * (cell + 2), y = pad + Math.floor(i / GX) * (cell + 2);
    c.fillStyle = G.visited.has(i) ? `hsl(${ROOM_HUE[i]},30%,26%)` : '#171b26';
    c.fillRect(x, y, cell, cell);
    if (i === 4) { c.fillStyle = '#ffd166'; c.font = '800 16px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('H', x + cell / 2, y + cell / 2 + 1); }
    if (i === room) { c.strokeStyle = COL_ME; c.lineWidth = 2; c.strokeRect(x + 1, y + 1, cell - 2, cell - 2); c.fillStyle = COL_ME; c.beginPath(); c.arc(x + cell / 2, y + cell / 2 + (i === 4 ? 11 : 0), 4, 0, 7); c.fill(); }
  }
}

function updateBar() {
  const btns = $('bar').children;
  const cdFrac = (ms, tot) => Math.min(1, ms / tot);
  const age = G.snapAt ? performance.now() - G.snapAt : 0;
  const tcd = Math.max(0, G.tcd - age), acd = Math.max(0, G.acd - age);
  for (const b of btns) {
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
