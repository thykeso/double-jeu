'use strict';
// DOUBLE JEU — serveur (Node + ws). Lance avec : npm install && npm start
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;

// ---------- Constantes de jeu ----------
const T = 48, RW = 13, RH = 9, GX = 3, GY = 3;
const WW = GX * RW, WH = GY * RH, RPX = RW * T, RPY = RH * T;
const HALF = 13, SPEED = 175, REACH = 36;
const DURATION = 240000, COUNTDOWN = 3500;
const SEARCH_MS = 900, DEFUSE_MS = 1300, EXTRACT_MS = 1800, PLACE_MS = 450;
const ATK_CD = 800, ATK_RANGE = 62, TRAP_CD = 3500, MAX_TRAPS = 5;
const FTYPES = [
  { n: 'bureau', w: 2 }, { n: 'armoire', w: 1 }, { n: 'commode', w: 2 },
  { n: 'bibliothèque', w: 2 }, { n: 'coffre', w: 1 }, { n: 'lit', w: 2 },
];
const ITEMS = ['Dossier', 'Clé', 'Plans', 'Disque'];
const TRAP_NAMES = ['', 'Bombe', 'Ressort', 'Colle'];
const START_ROOMS = [[0, 0], [2, 2]];

const rnd = (n) => Math.floor(Math.random() * n);

// ---------- Carte ----------
function isWall(wx, wy) {
  const rx = Math.floor(wx / RW), ry = Math.floor(wy / RH);
  const lx = wx % RW, ly = wy % RH;
  const edgeX = lx === 0 || lx === RW - 1, edgeY = ly === 0 || ly === RH - 1;
  if (!edgeX && !edgeY) return false;
  if (edgeX && edgeY) return true;
  if (edgeY) return !(lx === 6 && (ly === 0 ? ry > 0 : ry < GY - 1));
  return !(ly === 4 && (lx === 0 ? rx > 0 : rx < GX - 1));
}

function genLayout() {
  const solid = new Uint8Array(WW * WH);
  for (let y = 0; y < WH; y++) for (let x = 0; x < WW; x++) solid[y * WW + x] = isWall(x, y) ? 1 : 0;
  const furn = [];
  const occ = new Set();
  for (let ry = 0; ry < GY; ry++) {
    for (let rx = 0; rx < GX; rx++) {
      const center = rx === 1 && ry === 1;
      const start = START_ROOMS.some(([a, b]) => a === rx && b === ry);
      const target = center ? 2 : start ? 4 : 5 + rnd(2);
      let count = 0, tries = 0;
      while (count < target && tries++ < 300) {
        const ft = FTYPES[rnd(FTYPES.length)];
        const lx = 1 + rnd(RW - 2), ly = 1 + rnd(RH - 2);
        let ok = ly !== 4;
        const cells = [];
        for (let i = 0; i < ft.w && ok; i++) {
          const cx = lx + i;
          if (cx < 1 || cx > RW - 2 || cx === 6) ok = false;
          if (center && cx >= 4 && cx <= 8 && ly >= 3 && ly <= 5) ok = false;
          cells.push([rx * RW + cx, ry * RH + ly]);
        }
        if (!ok) continue;
        for (const [cx, cy] of cells) {
          for (let dx = -1; dx <= 1 && ok; dx++) for (let dy = -1; dy <= 1; dy++) {
            if (occ.has((cx + dx) + ',' + (cy + dy))) { ok = false; break; }
          }
        }
        if (!ok) continue;
        for (const [cx, cy] of cells) { occ.add(cx + ',' + cy); solid[cy * WW + cx] = 1; }
        furn.push({
          id: furn.length, rx, ry, x: cells[0][0], y: cells[0][1], w: ft.w,
          type: FTYPES.indexOf(ft), item: -1, searched: false, trap: null,
        });
        count++;
      }
    }
  }
  const eligible = furn.filter((f) => {
    const center = f.rx === 1 && f.ry === 1;
    const start = START_ROOMS.some(([a, b]) => a === f.rx && b === f.ry);
    return !center && !start;
  });
  for (let i = eligible.length - 1; i > 0; i--) { const j = rnd(i + 1); [eligible[i], eligible[j]] = [eligible[j], eligible[i]]; }
  for (let i = 0; i < ITEMS.length; i++) eligible[i].item = i;
  return { solid, furn };
}

// ---------- Partie ----------
class Game {
  constructor(sockets, names) {
    this.ws = sockets;
    this.names = names;
    const { solid, furn } = genLayout();
    this.solid = solid;
    this.furn = furn;
    this.pl = [0, 1].map((i) => ({
      x: (START_ROOMS[i][0] * RW + 6.5) * T, y: (START_ROOMS[i][1] * RH + 4.5) * T,
      fx: 0, fy: 1, inp: { x: 0, y: 0 }, items: [], charges: 3,
      stun: 0, slow: 0, imm: 0, atkCd: 0, trapCd: 0, swing: 0, act: null,
    }));
    this.phase = 'count';
    this.now = Date.now();
    this.last = this.now;
    this.startAt = this.now + COUNTDOWN;
    this.endAt = 0;
    this.timer = setInterval(() => this.tick(), 33);
  }

  layoutForClient() {
    return this.furn.map((f) => ({ id: f.id, x: f.x, y: f.y, w: f.w, type: f.type }));
  }

  send(i, o) { const s = this.ws[i]; if (s && s.readyState === 1) s.send(JSON.stringify(o)); }
  both(o) { this.send(0, o); this.send(1, o); }
  say(i, m, k, snd) { this.send(i, { t: 'ev', m, k: k || 'info', snd: snd || '' }); }

  roomOf(p) { return Math.floor(p.x / RPX) + Math.floor(p.y / RPY) * GX; }

  collides(x, y) {
    const x0 = Math.floor((x - HALF) / T), x1 = Math.floor((x + HALF - 0.001) / T);
    const y0 = Math.floor((y - HALF) / T), y1 = Math.floor((y + HALF - 0.001) / T);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
      if (tx < 0 || ty < 0 || tx >= WW || ty >= WH || this.solid[ty * WW + tx]) return true;
    }
    return false;
  }

  nearestFurn(p) {
    let best = null, bd = REACH;
    for (const f of this.furn) {
      const x0 = f.x * T, y0 = f.y * T, x1 = x0 + f.w * T, y1 = y0 + T;
      const dx = Math.max(x0 - p.x, 0, p.x - x1), dy = Math.max(y0 - p.y, 0, p.y - y1);
      const d = Math.hypot(dx, dy);
      if (d <= bd) { bd = d; best = f; }
    }
    return best;
  }

  nearExit(p) {
    const cx = (1 * RW + 6.5) * T, cy = (1 * RH + 4.5) * T;
    return Math.hypot(p.x - cx, p.y - cy) < 80;
  }

  tick() {
    const now = Date.now();
    this.now = now;
    const dt = Math.min(0.06, (now - this.last) / 1000);
    this.last = now;
    if (this.phase === 'count' && now >= this.startAt) {
      this.phase = 'play';
      this.endAt = now + DURATION;
      this.both({ t: 'go' });
    }
    if (this.phase === 'play') {
      this.updatePlayer(0, dt);
      this.updatePlayer(1, dt);
      if (this.phase === 'play' && now >= this.endAt) this.timeout();
    }
    if (this.phase !== 'over') { this.send(0, this.snap(0)); this.send(1, this.snap(1)); }
  }

  updatePlayer(i, dt) {
    const p = this.pl[i], now = this.now;
    const stunned = now < p.stun;
    if (stunned && p.act) p.act = null;
    const moving = p.inp.x !== 0 || p.inp.y !== 0;
    if (p.act) {
      if (moving) { p.act = null; this.send(i, { t: 'cancel' }); }
      else if (now >= p.act.end) this.finishAct(i);
    }
    if (this.phase !== 'play') return;
    if (!stunned && !p.act && moving) {
      const len = Math.hypot(p.inp.x, p.inp.y);
      const dx = p.inp.x / len, dy = p.inp.y / len;
      p.fx = dx; p.fy = dy;
      const sp = SPEED * (now < p.slow ? 0.5 : 1) * dt;
      if (!this.collides(p.x + dx * sp, p.y)) p.x += dx * sp;
      if (!this.collides(p.x, p.y + dy * sp)) p.y += dy * sp;
    }
  }

  startAct(i, k) {
    if (this.phase !== 'play') return;
    const p = this.pl[i], now = this.now;
    if (now < p.stun || p.act) return;
    if (k === 'atk') return this.attack(i);
    const f = this.nearestFurn(p);
    if (k === 'e') {
      if (p.items.length === ITEMS.length && this.nearExit(p)) {
        p.act = { type: 'extract', end: now + EXTRACT_MS, dur: EXTRACT_MS };
        return;
      }
      if (this.nearExit(p) && !f) return this.say(i, 'Il vous faut les 4 objets pour monter dans l’hélico.', 'warn');
      if (!f) return this.say(i, 'Rien à fouiller ici.', 'warn');
      p.act = { type: 'search', fid: f.id, end: now + SEARCH_MS, dur: SEARCH_MS };
    } else if (k === 'r') {
      if (p.charges <= 0) return this.say(i, 'Plus de pinces de désamorçage !', 'warn');
      if (!f) return this.say(i, 'Approchez-vous d’un meuble pour désamorcer.', 'warn');
      p.act = { type: 'defuse', fid: f.id, end: now + DEFUSE_MS, dur: DEFUSE_MS };
    } else if (k === 1 || k === 2 || k === 3) {
      if (now < p.trapCd) return this.say(i, 'Piège pas encore prêt.', 'warn');
      const mine = this.furn.filter((x) => x.trap && x.trap.owner === i).length;
      if (mine >= MAX_TRAPS) return this.say(i, `Maximum ${MAX_TRAPS} pièges actifs.`, 'warn');
      if (!f) return this.say(i, 'Approchez-vous d’un meuble pour poser un piège.', 'warn');
      if (f.trap) return this.say(i, 'Ce meuble est déjà piégé.', 'warn');
      p.act = { type: 'place', fid: f.id, kind: k, end: now + PLACE_MS, dur: PLACE_MS };
    }
  }

  finishAct(i) {
    const p = this.pl[i], a = p.act;
    p.act = null;
    if (a.type === 'extract') {
      if (p.items.length === ITEMS.length && this.nearExit(p)) this.finish(i, 'extraction');
      return;
    }
    const f = this.furn[a.fid];
    if (a.type === 'search') {
      f.searched = true;
      if (f.trap && f.trap.owner !== i) {
        const kind = f.trap.kind, owner = f.trap.owner;
        f.trap = null;
        this.trigger(i, kind);
        this.say(owner, `Votre piège « ${TRAP_NAMES[kind]} » a frappé !`, 'good', 'trap');
        const other = this.pl[1 - i];
        if (this.roomOf(other) !== this.roomOf(p)) this.say(1 - i, '', 'noise', 'noise');
      } else if (f.item >= 0) {
        p.items.push(f.item);
        this.say(i, `Trouvé : ${ITEMS[f.item]} !`, 'good', 'find');
        f.item = -1;
        this.say(1 - i, 'Quelqu’un a mis la main sur un objet secret…', 'warn');
      } else {
        this.say(i, 'Rien ici.', 'info', 'tick');
      }
    } else if (a.type === 'defuse') {
      p.charges--;
      if (f.trap && f.trap.owner !== i) {
        const kind = f.trap.kind;
        f.trap = null;
        this.say(i, `Piège « ${TRAP_NAMES[kind]} » désamorcé !`, 'good', 'defuse');
        this.say(1 - i, 'Un de vos pièges vient d’être désamorcé.', 'warn');
      } else {
        this.say(i, 'Rien à désamorcer ici… (pince gaspillée)', 'warn');
      }
    } else if (a.type === 'place') {
      if (f.trap) return;
      f.trap = { kind: a.kind, owner: i };
      p.trapCd = this.now + TRAP_CD;
      this.say(i, `Piège « ${TRAP_NAMES[a.kind]} » posé sur le ${FTYPES[f.type].n}.`, 'info', 'set');
    }
  }

  trigger(i, kind) {
    const v = this.pl[i], now = this.now;
    if (kind === 1) {
      v.stun = now + 3500; v.imm = v.stun + 800;
      const n = this.dropItems(i, 99);
      this.say(i, '💥 BOUM ! Vous êtes sonné' + (n ? ' et vous lâchez vos objets !' : ' !'), 'bad', 'boom');
    } else if (kind === 2) {
      v.stun = now + 2500; v.imm = v.stun + 800;
      const n = this.dropItems(i, 1);
      this.say(i, '🪤 Ressort ! Vous êtes projeté' + (n ? ' et lâchez un objet !' : ' !'), 'bad', 'boing');
    } else {
      v.stun = now + 800; v.slow = now + 7000;
      this.say(i, '🟢 De la colle ! Vous êtes ralenti pendant 7 s.', 'bad', 'splat');
    }
  }

  dropItems(i, n) {
    const v = this.pl[i];
    let dropped = 0;
    const room = this.roomOf(v);
    while (dropped < n && v.items.length) {
      const idx = rnd(v.items.length);
      const it = v.items.splice(idx, 1)[0];
      let pool = this.furn.filter((f) => f.item < 0 && f.rx + f.ry * GX === room);
      if (!pool.length) pool = this.furn.filter((f) => f.item < 0);
      const f = pool[rnd(pool.length)];
      f.item = it; f.searched = false;
      dropped++;
    }
    return dropped;
  }

  attack(i) {
    const p = this.pl[i], o = this.pl[1 - i], now = this.now;
    if (now < p.atkCd) return;
    p.atkCd = now + ATK_CD;
    p.swing = now + 200;
    if (this.roomOf(o) !== this.roomOf(p)) return;
    if (Math.hypot(o.x - p.x, o.y - p.y) > ATK_RANGE) return;
    if (now < o.stun || now < o.imm) return;
    o.stun = now + 1600; o.imm = o.stun + 1200;
    const n = this.dropItems(1 - i, 1);
    this.say(i, 'Touché !' + (n ? ' Il a lâché un objet dans la pièce.' : ''), 'good', 'hit');
    this.say(1 - i, 'Assommé !' + (n ? ' Vous avez lâché un objet dans la pièce.' : ''), 'bad', 'hit');
  }

  timeout() {
    const a = this.pl[0].items.length, b = this.pl[1].items.length;
    this.finish(a === b ? -1 : a > b ? 0 : 1, 'temps');
  }

  finish(winner, reason) {
    if (this.phase === 'over') return;
    this.phase = 'over';
    clearInterval(this.timer);
    this.both({ t: 'over', w: winner, reason, n: [this.pl[0].items.length, this.pl[1].items.length] });
  }

  snap(i) {
    const p = this.pl[i], o = this.pl[1 - i], now = this.now;
    const room = this.roomOf(p);
    const pack = (q) => ({
      x: Math.round(q.x * 10) / 10, y: Math.round(q.y * 10) / 10, fx: q.fx, fy: q.fy,
      stn: now < q.stun ? 1 : 0, swg: now < q.swing ? 1 : 0, slw: now < q.slow ? 1 : 0, imm: now < q.imm ? 1 : 0,
      act: q.act ? { k: q.act.type, p: Math.min(1, 1 - (q.act.end - now) / q.act.dur), f: q.act.fid } : null,
    });
    const fs = [];
    for (const f of this.furn) {
      if (f.rx + f.ry * GX !== room) continue;
      fs.push([f.id, f.searched ? 1 : 0, f.trap && f.trap.owner === i ? f.trap.kind : 0]);
    }
    return {
      t: 's',
      ph: this.phase,
      cd: this.phase === 'count' ? Math.max(0, this.startAt - now) : 0,
      tm: this.phase === 'play' ? Math.max(0, this.endAt - now) : DURATION,
      me: Object.assign(pack(p), {
        it: p.items, ch: p.charges,
        tcd: Math.max(0, p.trapCd - now), acd: Math.max(0, p.atkCd - now),
      }),
      op: this.roomOf(o) === room ? pack(o) : null,
      oi: o.items.length,
      fs,
    };
  }
}

// ---------- Salons ----------
const rooms = new Map();
let queue = null;

function newCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += A[rnd(A.length)];
    if (!rooms.has(c)) return c;
  }
}
function send(ws, o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }

function startMatch(room) {
  const names = room.ws.map((s) => s.name);
  room.rematch = [false, false];
  room.game = new Game(room.ws, names);
  room.ws.forEach((s, i) => send(s, {
    t: 'start', you: i, names, layout: room.game.layoutForClient(), dur: DURATION,
  }));
}

function leaveRoom(ws) {
  if (queue === ws) queue = null;
  const room = ws.room;
  if (!room) return;
  ws.room = null;
  if (room.game && room.game.phase !== 'over') {
    const other = room.ws[1 - ws.idx];
    room.game.finish(1 - ws.idx, 'forfait');
    if (other) send(other, { t: 'notice', m: 'Votre adversaire a quitté la partie.' });
  } else if (room.game) {
    const other = room.ws[1 - ws.idx];
    if (other) send(other, { t: 'notice', m: 'Votre adversaire a quitté le salon.' });
  }
  room.ws[ws.idx] = null;
  if (!room.ws[0] && !room.ws[1]) rooms.delete(room.code);
}

function cleanName(n) {
  n = String(n || '').replace(/[<>&"'`\\]/g, '').trim().slice(0, 14);
  return n || 'Agent';
}

// ---------- HTTP statique ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  let url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/') url = '/index.html';
  const file = path.normalize(path.join(__dirname, 'public', url));
  if (!file.startsWith(path.join(__dirname, 'public'))) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Introuvable'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server, maxPayload: 2048 });
wss.on('connection', (ws) => {
  ws.name = 'Agent'; ws.room = null; ws.idx = 0; ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.t !== 'string') return;
    const g = ws.room && ws.room.game;
    switch (m.t) {
      case 'in': {
        if (!g || g.phase === 'over') return;
        const c = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);
        g.pl[ws.idx].inp = { x: c(+m.x), y: c(+m.y) };
        break;
      }
      case 'a':
        if (g) g.startAct(ws.idx, m.k === 'e' || m.k === 'r' || m.k === 'atk' ? m.k : [1, 2, 3].includes(m.k) ? m.k : '');
        break;
      case 'create': {
        if (ws.room) leaveRoom(ws);
        ws.name = cleanName(m.name);
        const code = newCode();
        const room = { code, ws: [ws, null], game: null, rematch: [false, false] };
        rooms.set(code, room);
        ws.room = room; ws.idx = 0;
        send(ws, { t: 'wait', code });
        break;
      }
      case 'join': {
        if (ws.room) leaveRoom(ws);
        ws.name = cleanName(m.name);
        const room = rooms.get(String(m.code || '').toUpperCase().slice(0, 4));
        if (!room) return send(ws, { t: 'err', m: 'Salon introuvable. Vérifiez le code.' });
        if (room.ws[1] || room.game) return send(ws, { t: 'err', m: 'Ce salon est déjà complet.' });
        room.ws[1] = ws; ws.room = room; ws.idx = 1;
        startMatch(room);
        break;
      }
      case 'quick': {
        if (ws.room) leaveRoom(ws);
        ws.name = cleanName(m.name);
        if (queue && queue !== ws && queue.readyState === 1) {
          const other = queue; queue = null;
          const code = newCode();
          const room = { code, ws: [other, ws], game: null, rematch: [false, false] };
          rooms.set(code, room);
          other.room = room; other.idx = 0; ws.room = room; ws.idx = 1;
          startMatch(room);
        } else {
          queue = ws;
          send(ws, { t: 'wait', code: null });
        }
        break;
      }
      case 'again': {
        const room = ws.room;
        if (!room || !room.game || room.game.phase !== 'over') return;
        room.rematch[ws.idx] = true;
        if (room.ws[0] && room.ws[1] && room.rematch[0] && room.rematch[1]) startMatch(room);
        else send(room.ws[1 - ws.idx], { t: 'notice', m: `${ws.name} veut rejouer !` });
        break;
      }
      case 'leave': leaveRoom(ws); break;
    }
  });
  ws.on('close', () => leaveRoom(ws));
  ws.on('error', () => {});
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch { /* ignore */ }
  }
}, 20000);

if (require.main === module) server.listen(PORT, () => console.log(`Double Jeu en ligne sur http://localhost:${PORT}`));
module.exports = { Game, genLayout, ITEMS };
