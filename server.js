'use strict';
// DOUBLE JEU — serveur (Node + ws). Lance avec : npm install && npm start
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;

// ---------- Constantes de jeu ----------
const T = 48, RW = 13, RH = 9, RPX = RW * T, RPY = RH * T;
const HALF = 13, SPEED = 175, REACH = 36;
const COUNTDOWN = 3500;
const SEARCH_MS = 900, DEFUSE_MS = 1300, EXTRACT_MS = 1800, PLACE_MS = 450;
const ATK_CD = 800, ATK_RANGE = 62, TRAP_CD = 3500, MAX_TRAPS = 5;
const FTYPES = [
  { n: 'bureau', w: 2 }, { n: 'armoire', w: 1 }, { n: 'commode', w: 2 },
  { n: 'bibliothèque', w: 2 }, { n: 'coffre', w: 1 }, { n: 'lit', w: 2 },
];
const ITEMS = ['Dossier', 'Clé', 'Plans', 'Disque', 'Mallette', 'Passeport', 'Micro-film', 'Lingot', 'Code', 'Carnet'];
const TRAP_NAMES = ['', 'Bombe', 'Ressort', 'Colle'];
const BOT_NAMES = ['Bot Alpha', 'Bot Bravo', 'Bot Charlie', 'Bot Delta'];
const MAPS = { '2x3': [2, 3], '3x3': [3, 3], '3x4': [3, 4], '4x4': [4, 4], '5x5': [5, 5] };
const TIMES = [120, 180, 240, 300, 420, 600];
const BOT_TRAP_P = +process.env.BOT_TRAP_P || 0.15, BOT_AGGR = +process.env.BOT_AGGR || 0.25;
const DEFAULT_CFG = { items: 4, map: '3x3', time: 240, players: 2 };

const rnd = (n) => Math.floor(Math.random() * n);

// ---------- Carte ----------
function isWall(wx, wy, GX, GY) {
  const rx = Math.floor(wx / RW), ry = Math.floor(wy / RH);
  const lx = wx % RW, ly = wy % RH;
  const edgeX = lx === 0 || lx === RW - 1, edgeY = ly === 0 || ly === RH - 1;
  if (!edgeX && !edgeY) return false;
  if (edgeX && edgeY) return true;
  if (edgeY) return !(lx === 6 && (ly === 0 ? ry > 0 : ry < GY - 1));
  return !(ly === 4 && (lx === 0 ? rx > 0 : rx < GX - 1));
}

function startRooms(GX, GY, n, exit) {
  const cand = [[0, 0], [GX - 1, GY - 1], [GX - 1, 0], [0, GY - 1], [0, Math.floor(GY / 2)]]
    .filter(([a, b]) => !(a === exit[0] && b === exit[1]));
  return cand.slice(0, n);
}

function genLayout(GX, GY, nPlayers, nItems) {
  const WW = GX * RW, WH = GY * RH;
  const exit = [Math.floor(GX / 2), Math.floor(GY / 2)];
  const starts = startRooms(GX, GY, nPlayers, exit);
  const solid = new Uint8Array(WW * WH);
  for (let y = 0; y < WH; y++) for (let x = 0; x < WW; x++) solid[y * WW + x] = isWall(x, y, GX, GY) ? 1 : 0;
  const furn = [];
  const occ = new Set();
  const isStart = (rx, ry) => starts.some(([a, b]) => a === rx && b === ry);
  for (let ry = 0; ry < GY; ry++) {
    for (let rx = 0; rx < GX; rx++) {
      const center = rx === exit[0] && ry === exit[1];
      const target = center ? 2 : isStart(rx, ry) ? 4 : 5 + rnd(2);
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
  const notExit = furn.filter((f) => !(f.rx === exit[0] && f.ry === exit[1]));
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const primary = shuffle(notExit.filter((f) => !isStart(f.rx, f.ry)));
  const fallback = shuffle(notExit.filter((f) => isStart(f.rx, f.ry)));
  const eligible = primary.concat(fallback);
  for (let i = 0; i < nItems; i++) eligible[i].item = i;
  return { solid, furn, starts, exit, WW, WH };
}

// ---------- Partie ----------
class Game {
  constructor(members, cfg, opts = {}) {
    this.clock = opts.clock || Date.now;
    const [GX, GY] = MAPS[cfg.map];
    this.GX = GX; this.GY = GY;
    this.nItems = cfg.items;
    this.duration = cfg.time * 1000;
    this.N = members.length;
    this.names = members.map((m) => m.name);
    this.ws = members.map((m) => m.ws || null);
    const L = genLayout(GX, GY, this.N, this.nItems);
    this.solid = L.solid; this.furn = L.furn; this.starts = L.starts; this.exit = L.exit;
    this.WW = L.WW; this.WH = L.WH;
    this.froom = this.furn.map((f) => f.rx + f.ry * GX);
    this.exitPx = [(this.exit[0] * RW + 6.5) * T, (this.exit[1] * RH + 4.5) * T];
    this.pl = members.map((m, i) => ({
      x: (this.starts[i][0] * RW + 6.5) * T, y: (this.starts[i][1] * RH + 4.5) * T,
      fx: 0, fy: 1, inp: { x: 0, y: 0 }, items: [], charges: 3, gone: false,
      stun: 0, slow: 0, imm: 0, atkCd: 0, trapCd: 0, swing: 0, act: null,
      bot: !!m.bot, known: new Set(),
      ai: m.bot ? { stage: 'idle', path: null, pi: 0, task: null, wait: 0, after: 'idle', fail: 0, defTried: false, sx: 0, sy: 0, stuckAt: 0, aggr: Math.random() < BOT_AGGR } : null,
    }));
    this.phase = 'count';
    this.now = this.clock();
    this.last = this.now;
    this.startAt = this.now + COUNTDOWN;
    this.endAt = 0;
    if (!opts.manual) this.timer = setInterval(() => this.tick(), 33);
  }

  layoutForClient() {
    return this.furn.map((f) => ({ id: f.id, x: f.x, y: f.y, w: f.w, type: f.type }));
  }

  send(i, o) { const s = this.ws[i]; if (s && s.readyState === 1) s.send(JSON.stringify(o)); }
  all(o) { for (let i = 0; i < this.N; i++) this.send(i, o); }
  say(i, m, k, snd) { this.send(i, { t: 'ev', m, k: k || 'info', snd: snd || '' }); }
  others(i) { const r = []; for (let j = 0; j < this.N; j++) if (j !== i && !this.pl[j].gone) r.push(j); return r; }
  active() { const r = []; for (let j = 0; j < this.N; j++) if (!this.pl[j].gone) r.push(j); return r; }

  roomOf(p) { return Math.floor(p.x / RPX) + Math.floor(p.y / RPY) * this.GX; }

  collides(x, y) {
    const x0 = Math.floor((x - HALF) / T), x1 = Math.floor((x + HALF - 0.001) / T);
    const y0 = Math.floor((y - HALF) / T), y1 = Math.floor((y + HALF - 0.001) / T);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
      if (tx < 0 || ty < 0 || tx >= this.WW || ty >= this.WH || this.solid[ty * this.WW + tx]) return true;
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

  nearExit(p) { return Math.hypot(p.x - this.exitPx[0], p.y - this.exitPx[1]) < 80; }

  tick() {
    const now = this.clock();
    this.now = now;
    const dt = Math.min(0.06, (now - this.last) / 1000);
    this.last = now;
    if (this.phase === 'count' && now >= this.startAt) {
      this.phase = 'play';
      this.endAt = now + this.duration;
      this.all({ t: 'go' });
    }
    if (this.phase === 'play') {
      for (let i = 0; i < this.N; i++) {
        if (this.pl[i].gone) continue;
        if (this.pl[i].bot) this.botThink(i);
        this.updatePlayer(i, dt);
        if (this.phase !== 'play') break;
      }
      if (this.phase === 'play' && now >= this.endAt) this.timeout();
    }
    if (this.phase !== 'over') for (let i = 0; i < this.N; i++) if (this.ws[i]) this.send(i, this.snap(i));
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

  reachOf(p, f) {
    const x0 = f.x * T, y0 = f.y * T, x1 = x0 + f.w * T, y1 = y0 + T;
    return Math.hypot(Math.max(x0 - p.x, 0, p.x - x1), Math.max(y0 - p.y, 0, p.y - y1));
  }

  // fid (facultatif, utilisé par les bots) : meuble visé précisément s'il est à portée,
  // sinon le plus proche (comportement des joueurs humains).
  startAct(i, k, fid) {
    if (this.phase !== 'play') return;
    const p = this.pl[i], now = this.now;
    if (p.gone || now < p.stun || p.act) return;
    if (k === 'atk') return this.attack(i);
    const target = fid !== undefined ? this.furn[fid] : null;
    const f = target && this.reachOf(p, target) <= REACH ? target : this.nearestFurn(p);
    if (k === 'e') {
      if (p.items.length === this.nItems && this.nearExit(p)) {
        p.act = { type: 'extract', end: now + EXTRACT_MS, dur: EXTRACT_MS };
        return;
      }
      if (this.nearExit(p) && !f) return this.say(i, `Il vous faut ${this.nItems > 1 ? 'les ' + this.nItems + ' objets' : 'l’objet'} pour monter dans l’hélico.`, 'warn');
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
      if (p.items.length === this.nItems && this.nearExit(p)) this.finish([i], 'extraction');
      return;
    }
    const f = this.furn[a.fid];
    if (a.type === 'search') {
      if (f.trap && f.trap.owner !== i) {
        // Le meuble n'est PAS marqué « fouillé » : il peut encore cacher un objet
        // et doit rester fouillable par les autres.
        const kind = f.trap.kind, owner = f.trap.owner;
        f.trap = null;
        this.trigger(i, kind);
        this.say(owner, `Votre piège « ${TRAP_NAMES[kind]} » a frappé !`, 'good', 'trap');
        const room = this.roomOf(p);
        for (const j of this.others(i)) {
          if (j !== owner && this.roomOf(this.pl[j]) !== room) this.say(j, '', 'noise', 'noise');
        }
      } else if (f.item >= 0) {
        f.searched = true; p.known.add(f.id);
        p.items.push(f.item);
        this.say(i, `Trouvé : ${ITEMS[f.item]} !`, 'good', 'find');
        f.item = -1;
        for (const j of this.others(i)) this.say(j, 'Quelqu’un a mis la main sur un objet secret…', 'warn');
      } else {
        f.searched = true; p.known.add(f.id);
        this.say(i, 'Rien ici.', 'info', 'tick');
      }
    } else if (a.type === 'defuse') {
      p.charges--;
      if (f.trap && f.trap.owner !== i) {
        const kind = f.trap.kind, owner = f.trap.owner;
        f.trap = null;
        this.say(i, `Piège « ${TRAP_NAMES[kind]} » désamorcé !`, 'good', 'defuse');
        this.say(owner, 'Un de vos pièges vient d’être désamorcé.', 'warn');
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
      let pool = this.furn.filter((f) => f.item < 0 && this.froom[f.id] === room);
      if (!pool.length) pool = this.furn.filter((f) => f.item < 0);
      const f = pool[rnd(pool.length)];
      f.item = it; f.searched = false;
      dropped++;
    }
    return dropped;
  }

  attack(i) {
    const p = this.pl[i], now = this.now;
    if (now < p.atkCd) return;
    p.atkCd = now + ATK_CD;
    p.swing = now + 200;
    const room = this.roomOf(p);
    let target = -1, td = ATK_RANGE;
    for (const j of this.others(i)) {
      const o = this.pl[j];
      if (this.roomOf(o) !== room || now < o.stun || now < o.imm) continue;
      const d = Math.hypot(o.x - p.x, o.y - p.y);
      if (d <= td) { td = d; target = j; }
    }
    if (target < 0) return;
    const o = this.pl[target];
    o.stun = now + 1600; o.imm = o.stun + 1200;
    const n = this.dropItems(target, 1);
    this.say(i, 'Touché !' + (n ? ' Il a lâché un objet dans la pièce.' : ''), 'good', 'hit');
    this.say(target, 'Assommé !' + (n ? ' Vous avez lâché un objet dans la pièce.' : ''), 'bad', 'hit');
  }

  removePlayer(i) {
    const p = this.pl[i];
    if (p.gone) return;
    if (this.phase !== 'over') this.dropItems(i, 99);
    p.gone = true; p.act = null; p.inp = { x: 0, y: 0 };
    this.ws[i] = null;
    if (this.phase === 'over') return;
    const act = this.active();
    const humans = act.filter((j) => !this.pl[j].bot && this.ws[j]);
    if (!humans.length) return this.destroy();
    if (act.length <= 1) this.finish(act, 'forfait');
    else for (const j of act) this.say(j, `${this.names[i]} a quitté la partie.`, 'warn');
  }

  timeout() {
    const act = this.active();
    let top = -1;
    for (const j of act) top = Math.max(top, this.pl[j].items.length);
    this.finish(act.filter((j) => this.pl[j].items.length === top), 'temps');
  }

  finish(winners, reason) {
    if (this.phase === 'over') return;
    this.phase = 'over';
    clearInterval(this.timer);
    this.all({ t: 'over', w: winners, reason, n: this.pl.map((p) => p.items.length), act: this.active().length });
  }

  destroy() { this.phase = 'over'; clearInterval(this.timer); }

  snap(i) {
    const p = this.pl[i], now = this.now;
    const room = this.roomOf(p);
    const pack = (q) => ({
      x: Math.round(q.x * 10) / 10, y: Math.round(q.y * 10) / 10, fx: q.fx, fy: q.fy,
      stn: now < q.stun ? 1 : 0, swg: now < q.swing ? 1 : 0, slw: now < q.slow ? 1 : 0, imm: now < q.imm ? 1 : 0,
      act: q.act ? { k: q.act.type, p: Math.min(1, 1 - (q.act.end - now) / q.act.dur), f: q.act.fid } : null,
    });
    const fs = [];
    for (const f of this.furn) {
      if (this.froom[f.id] !== room) continue;
      fs.push([f.id, f.searched ? 1 : 0, f.trap && f.trap.owner === i ? f.trap.kind : 0]);
    }
    const ops = [];
    for (const j of this.others(i)) if (this.roomOf(this.pl[j]) === room) ops.push(Object.assign({ i: j }, pack(this.pl[j])));
    return {
      t: 's',
      ph: this.phase,
      cd: this.phase === 'count' ? Math.max(0, this.startAt - now) : 0,
      tm: this.phase === 'play' ? Math.max(0, this.endAt - now) : this.duration,
      me: Object.assign(pack(p), {
        it: p.items, ch: p.charges,
        tcd: Math.max(0, p.trapCd - now), acd: Math.max(0, p.atkCd - now),
      }),
      ops,
      ic: this.pl.map((q) => (q.gone ? 0 : q.items.length)),
      gn: this.pl.map((q) => (q.gone ? 1 : 0)),
      fs,
    };
  }

  // ---------- Intelligence artificielle ----------
  bfs(sx, sy) {
    const W = this.WW, H = this.WH, dist = new Int16Array(W * H).fill(-1), prev = new Int32Array(W * H).fill(-1);
    const q = [sy * W + sx];
    dist[sy * W + sx] = 0;
    for (let h = 0; h < q.length; h++) {
      const c = q[h], x = c % W, y = (c - x) / W;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const a = x + dx, b = y + dy;
        if (a < 0 || b < 0 || a >= W || b >= H) continue;
        const n = b * W + a;
        if (this.solid[n] || dist[n] >= 0) continue;
        dist[n] = dist[c] + 1; prev[n] = c; q.push(n);
      }
    }
    return { dist, prev };
  }

  pathTo(bf, tx, ty, sx, sy) {
    const W = this.WW, out = [];
    let c = ty * W + tx;
    const s = sy * W + sx;
    while (c !== s && c >= 0) { out.push([c % W, Math.floor(c / W)]); c = bf.prev[c]; }
    return out.reverse();
  }

  steer(p, tx, ty) {
    const dx = tx - p.x, dy = ty - p.y;
    p.inp = { x: Math.abs(dx) > 6 ? Math.sign(dx) : 0, y: Math.abs(dy) > 6 ? Math.sign(dy) : 0 };
  }

  botPlan(i) {
    const p = this.pl[i], b = p.ai, now = this.now;
    const sx = Math.floor(p.x / T), sy = Math.floor(p.y / T);
    const bf = this.bfs(sx, sy);
    b.wait = now + 120 + rnd(260);
    if (p.items.length >= this.nItems) {
      const tx = Math.floor(this.exitPx[0] / T), ty = Math.floor(this.exitPx[1] / T);
      if (bf.dist[ty * this.WW + tx] < 0) return;
      b.task = { t: 'exit' }; b.path = this.pathTo(bf, tx, ty, sx, sy); b.pi = 0; b.stage = 'move';
      b.sx = p.x; b.sy = p.y; b.stuckAt = now;
      return;
    }
    let best = null, bs = 1e9, bt = null;
    for (const f of this.furn) {
      if (p.known.has(f.id)) continue;
      let bd = 1e9, btile = null;
      const cand = [];
      for (let k = 0; k < f.w; k++) { cand.push([f.x + k, f.y - 1], [f.x + k, f.y + 1]); }
      cand.push([f.x - 1, f.y], [f.x + f.w, f.y]);
      for (const [cx, cy] of cand) {
        if (cx < 0 || cy < 0 || cx >= this.WW || cy >= this.WH) continue;
        const d = bf.dist[cy * this.WW + cx];
        if (d >= 0 && d < bd) { bd = d; btile = [cx, cy]; }
      }
      if (!btile) continue;
      const score = bd + (f.trap && f.trap.owner === i ? 30 : 0) + rnd(6);
      if (score < bs) { bs = score; best = f; bt = btile; }
    }
    if (!best) { p.known.clear(); return; }
    b.task = { t: 'search', fid: best.id };
    b.path = this.pathTo(bf, bt[0], bt[1], sx, sy); b.pi = 0; b.stage = 'move';
    b.sx = p.x; b.sy = p.y; b.stuckAt = now;
  }

  botThink(i) {
    const p = this.pl[i], b = p.ai, now = this.now;
    p.inp = { x: 0, y: 0 };
    if (now < p.stun) { b.stage = 'idle'; b.path = null; return; }
    if (p.act || now < b.wait) return;
    const room = this.roomOf(p);
    for (const f of this.furn) if (this.froom[f.id] === room) { if (f.searched) p.known.add(f.id); else p.known.delete(f.id); }

    // combat
    let en = null, ed = 1e9;
    for (const j of this.others(i)) {
      const q = this.pl[j];
      if (this.roomOf(q) !== room) continue;
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < ed) { ed = d; en = q; }
    }
    if (en && ed < 230 && now >= p.atkCd && now >= en.stun && now >= en.imm && (en.items.length > 0 || ed < 110 || b.aggr)) {
      if (ed < ATK_RANGE - 8) { this.startAct(i, 'atk'); b.wait = now + 200 + rnd(300); return; }
      this.steer(p, en.x, en.y);
      return;
    }

    switch (b.stage) {
      case 'idle': this.botPlan(i); break;
      case 'move': {
        if (!b.path || b.pi >= b.path.length) { b.stage = 'do'; break; }
        const [tx, ty] = b.path[b.pi];
        const cx = (tx + 0.5) * T, cy = (ty + 0.5) * T;
        if (Math.abs(p.x - cx) < 7 && Math.abs(p.y - cy) < 7) { b.pi++; break; }
        this.steer(p, cx, cy);
        if (now - b.stuckAt > 1300) {
          if (Math.hypot(p.x - b.sx, p.y - b.sy) < 8) {
            b.fail++;
            if (b.task && b.task.fid !== undefined && b.fail > 1) { p.known.add(b.task.fid); b.fail = 0; }
            b.stage = 'idle';
          }
          b.sx = p.x; b.sy = p.y; b.stuckAt = now;
        }
        break;
      }
      case 'do': {
        if (b.task && b.task.t === 'exit') {
          if (Math.hypot(p.x - this.exitPx[0], p.y - this.exitPx[1]) < 60) { this.startAct(i, 'e'); b.stage = 'wait'; b.after = 'idle'; }
          else b.stage = 'idle';
          break;
        }
        const tf = b.task && b.task.fid !== undefined ? this.furn[b.task.fid] : null;
        const f = tf && this.reachOf(p, tf) <= REACH ? tf : this.nearestFurn(p);
        if (!f) { if (b.task) p.known.add(b.task.fid); b.stage = 'idle'; break; }
        // Un piège posé sur un meuble déjà fouillé (donc grisé) ne servirait à rien :
        // le bot piège un meuble intact à la place de le fouiller, puis passe au suivant.
        if (!f.searched && !f.trap && now >= p.trapCd && Math.random() < BOT_TRAP_P
          && this.furn.filter((x) => x.trap && x.trap.owner === i).length < 4) {
          const r = Math.random();
          this.startAct(i, r < 0.4 ? 1 : r < 0.75 ? 2 : 3, f.id);
          b.stage = 'wait'; b.after = 'idle';
          break;
        }
        if (p.charges > 0 && !b.defTried && Math.random() < 0.15) { b.defTried = true; this.startAct(i, 'r', f.id); b.stage = 'wait'; b.after = 'do'; break; }
        b.defTried = false;
        this.startAct(i, 'e', f.id);
        b.stage = 'wait'; b.after = 'post';
        break;
      }
      case 'post': b.stage = 'idle'; break;
      case 'wait': b.stage = b.after; break;
      default: b.stage = 'idle';
    }
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
const playing = (room) => !!(room.game && room.game.phase !== 'over');

function sendLobby(room) {
  const members = room.members.map((m) => ({ n: m.name, b: m.bot ? 1 : 0, h: m === room.host ? 1 : 0 }));
  room.members.forEach((m, i) => {
    if (m.ws) send(m.ws, { t: 'lobby', code: room.code, you: i, host: m === room.host, members, cfg: room.cfg, playing: playing(room) });
  });
}

function startMatch(room) {
  if (room.game) room.game.destroy();
  room.game = new Game(room.members, room.cfg);
  const g = room.game;
  room.members.forEach((m, gi) => {
    m.gi = gi;
    if (m.ws) send(m.ws, {
      t: 'start', you: gi, names: g.names, layout: g.layoutForClient(), gx: g.GX, gy: g.GY,
      exit: g.exit, items: g.nItems, dur: g.duration,
    });
  });
}

function removeMember(room, m) {
  if (room.game && room.game.phase !== 'over' && m.gi >= 0 && !m.bot) room.game.removePlayer(m.gi);
  room.members = room.members.filter((x) => x !== m);
  if (!room.members.some((x) => !x.bot)) {
    if (room.game) room.game.destroy();
    rooms.delete(room.code);
    return false;
  }
  if (room.host === m) room.host = room.members.find((x) => !x.bot);
  return true;
}

function leaveRoom(ws) {
  if (queue === ws) queue = null;
  const room = ws.room, m = ws.mem;
  ws.room = null; ws.mem = null;
  if (!room || !m) return;
  if (removeMember(room, m)) sendLobby(room);
}

function cleanName(n) {
  n = String(n || '').replace(/[<>&"'`\\]/g, '').trim().slice(0, 14);
  return n || 'Agent';
}

function validCfg(c, room) {
  const cfg = Object.assign({}, room.cfg);
  const int = (v) => Math.floor(+v);
  if (c.items !== undefined && int(c.items) >= 1 && int(c.items) <= 10) cfg.items = int(c.items);
  if (MAPS[c.map]) cfg.map = c.map;
  if (TIMES.includes(int(c.time))) cfg.time = int(c.time);
  if (c.players !== undefined && int(c.players) >= 2 && int(c.players) <= 5) cfg.players = int(c.players);
  cfg.players = Math.max(cfg.players, room.members.length);
  return cfg;
}

function newRoom(ws, name) {
  const code = newCode();
  const m = { ws, bot: false, name, gi: -1 };
  const room = { code, members: [m], host: m, cfg: Object.assign({}, DEFAULT_CFG), game: null };
  rooms.set(code, room);
  ws.room = room; ws.mem = m;
  return room;
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
  ws.room = null; ws.mem = null; ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.t !== 'string') return;
    const room = ws.room, mem = ws.mem;
    const g = room && room.game;
    const isHost = room && mem === room.host;
    switch (m.t) {
      case 'in': {
        if (!g || g.phase === 'over' || !mem || mem.gi < 0) return;
        const c = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);
        const p = g.pl[mem.gi];
        if (p && !p.bot) p.inp = { x: c(+m.x), y: c(+m.y) };
        break;
      }
      case 'a':
        if (g && mem && mem.gi >= 0) g.startAct(mem.gi, m.k === 'e' || m.k === 'r' || m.k === 'atk' ? m.k : [1, 2, 3].includes(m.k) ? m.k : '');
        break;
      case 'create': {
        if (ws.room) leaveRoom(ws);
        const r = newRoom(ws, cleanName(m.name));
        if (m.bots) r.members.push({ ws: null, bot: true, name: BOT_NAMES[0], gi: -1 });
        sendLobby(r);
        break;
      }
      case 'join': {
        if (ws.room) leaveRoom(ws);
        const r = rooms.get(String(m.code || '').toUpperCase().slice(0, 4));
        if (!r) return send(ws, { t: 'err', m: 'Salon introuvable. Vérifiez le code.' });
        if (playing(r)) return send(ws, { t: 'err', m: 'Une partie est déjà en cours dans ce salon.' });
        if (r.members.length >= r.cfg.players) return send(ws, { t: 'err', m: 'Ce salon est complet.' });
        const nm = { ws, bot: false, name: cleanName(m.name), gi: -1 };
        r.members.push(nm); ws.room = r; ws.mem = nm;
        sendLobby(r);
        break;
      }
      case 'cfg':
        if (!room || !isHost || playing(room)) return;
        room.cfg = validCfg(m, room);
        sendLobby(room);
        break;
      case 'addbot': {
        if (!room || !isHost || playing(room) || room.members.length >= room.cfg.players) return;
        const used = new Set(room.members.map((x) => x.name));
        const name = BOT_NAMES.find((n) => !used.has(n)) || 'Bot ' + room.members.length;
        room.members.push({ ws: null, bot: true, name, gi: -1 });
        sendLobby(room);
        break;
      }
      case 'kick': {
        if (!room || !isHost || playing(room)) return;
        const target = room.members[+m.i];
        if (!target || target === mem) return;
        if (target.ws) { target.ws.room = null; target.ws.mem = null; send(target.ws, { t: 'kicked' }); }
        removeMember(room, target);
        sendLobby(room);
        break;
      }
      case 'start':
        if (!room || !isHost || playing(room)) return;
        if (room.members.length < 2) return send(ws, { t: 'err2', m: 'Il faut au moins 2 joueurs (ajoute un bot ou invite un ami).' });
        startMatch(room);
        break;
      case 'quick': {
        if (ws.room) leaveRoom(ws);
        const name = cleanName(m.name);
        if (queue && queue !== ws && queue.readyState === 1) {
          const other = queue; queue = null;
          const r = newRoom(other, other.qname || 'Agent');
          const nm = { ws, bot: false, name, gi: -1 };
          r.members.push(nm); ws.room = r; ws.mem = nm;
          startMatch(r);
        } else {
          ws.qname = name; queue = ws;
          send(ws, { t: 'wait' });
        }
        break;
      }
      case 'back':
        if (room && !playing(room)) sendLobby(room);
        break;
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
module.exports = { Game, genLayout, ITEMS, MAPS, DEFAULT_CFG };
