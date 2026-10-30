'use strict';
/* 코미꼬 로마 오디오 가이드 v2 — 오프라인 재생 · 지도 · GPS · 사진 */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const CONTENT_CACHE = 'content-v2';
const LS = {
  get(k, d) { try { const v = localStorage.getItem('guide.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('guide.' + k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem('guide.' + k); } catch (e) {} },
};
const S = {
  cat: null, key: null, tour: null, track: null, map: null, layers: {}, gps: null, gpsWatch: null,
  follow: true, imgIdx: -1, prog: LS.get('prog', {}), speed: LS.get('speed', 1), auto: LS.get('auto', false),
  urls: new Map(), texts: {}, paraEnds: [], paraOn: -1, saving: {},
};
const audio = $('#audio');

/* ---------- 공통 ---------- */
function toast(msg, ms = 2200) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on'), ms); }
function fmt(s) { s = Math.max(0, Math.round(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
function fmtLong(s) { const m = Math.round(s / 60); return m >= 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${m}분`; }
function mb(b) { return (b / 1e6).toFixed(0) + 'MB'; }
function show(id) { $$('.screen').forEach(s => s.hidden = s.id !== id); window.scrollTo(0, 0); }
function trackById(id) { for (const t of S.cat.tours) { const x = t.tracks.find(k => k.id === id); if (x) return [t, x]; } return [null, null]; }
function b64(u8) { let s = ''; u8.forEach(c => s += String.fromCharCode(c)); return btoa(s); }
function ub64(s) { return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }

/* ---------- 암호 ---------- */
async function deriveKey(pw) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(S.cat.salt), iterations: S.cat.iter }, base, 256);
  return new Uint8Array(bits);
}
async function importKey(raw) { return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']); }
async function fetchBuf(rel) {
  const c = await caches.open(CONTENT_CACHE).catch(() => null);
  let r = c && await c.match(rel);
  if (!r) {
    r = await fetch(rel);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    if (c) c.put(rel, r.clone()).catch(() => {});
  }
  return r.arrayBuffer();
}
async function decrypt(buf, key = S.key) {
  const u = new Uint8Array(buf);
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: u.slice(0, 12) }, key, u.slice(12));
}
async function blobUrl(rel, type) {
  if (S.urls.has(rel)) return S.urls.get(rel);
  const p = (async () => URL.createObjectURL(new Blob([await decrypt(await fetchBuf(rel))], { type })))();
  S.urls.set(rel, p);
  p.catch(() => S.urls.delete(rel));
  return p;
}
const imgUrl = rel => blobUrl(rel, 'image/jpeg');
async function getTexts(tour) {
  if (!S.texts[tour.id]) S.texts[tour.id] = JSON.parse(new TextDecoder().decode(await decrypt(await fetchBuf(tour.text))));
  return S.texts[tour.id];
}

/* ---------- 시작 ---------- */
async function boot() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded || !audio.paused) return; reloaded = true; location.reload();
    });
  }
  try { S.cat = await (await fetch('data/catalog.json', { cache: 'no-cache' })).json(); }
  catch (e) { S.cat = await (await caches.match('data/catalog.json'))?.json(); }
  if (!S.cat) { document.body.innerHTML = '<p style="padding:40px">처음 한 번은 인터넷 연결이 필요해요.</p>'; return; }
  const raw = LS.get('key', null);
  if (raw) { try { S.key = await importKey(ub64(raw)); } catch (e) { S.key = null; } }
  if (!S.key) { show('lock'); setTimeout(() => $('#pw').focus(), 300); return; }
  start();
}
$('#lockForm').addEventListener('submit', async e => {
  e.preventDefault();
  const pw = $('#pw').value.trim(); if (!pw) return;
  $('#lockMsg').textContent = '확인 중…';
  try {
    const raw = await deriveKey(pw); const key = await importKey(raw);
    await decrypt(await fetchBuf(S.cat.check), key);
    S.key = key; LS.set('key', b64(raw)); $('#lockMsg').textContent = ''; start();
  } catch (err) { $('#lockMsg').textContent = '비밀번호가 맞지 않아요.'; }
});

function start() {
  cleanupContent();
  renderHome(); show('home');
  const last = LS.get('last', null);
  if (last) { const [, k] = trackById(last); if (k) loadTrack(k, false); }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
}

/* ---------- 홈 ---------- */
async function renderHome() {
  const box = $('#tourCards'); box.innerHTML = '';
  for (const t of S.cat.tours) {
    const total = t.tracks.reduce((a, k) => a + k.dur, 0);
    const done = t.tracks.filter(k => S.prog[k.id]?.done).length;
    const el = document.createElement('article'); el.className = 'card';
    el.innerHTML = `<button class="cover" aria-label="${t.title} 열기"><h2>${t.title}</h2></button>
      <div class="body"><p class="sub">${t.sub}</p>
      <div class="row"><span class="stat">${t.tracks.length}트랙 · ${fmtLong(total)}${done ? ` · ${done}개 들음` : ''}</span>
      <button class="btn primary open">열기</button></div>
      <div class="save" data-tour="${t.id}"></div></div>`;
    el.querySelector('.cover').onclick = el.querySelector('.open').onclick = () => openTour(t);
    box.appendChild(el);
    imgUrl(t.cover).then(u => el.querySelector('.cover').style.backgroundImage = `url("${u}")`).catch(() => {});
    renderSave(t);
  }
  renderResume();
}
function renderResume() {
  const box = $('#resume'); box.innerHTML = '';
  if (!S.track) return;
  const t = S.track, p = S.prog[t.id];
  const b = document.createElement('button'); b.className = 'resume';
  b.innerHTML = `<img alt=""><div><small>이어 듣기 · ${S.ptour.short}</small><b>${t.code} ${t.title}</b><small>${p && p.pos ? fmt(p.pos) + ' / ' : ''}${fmt(t.dur)}</small></div>`;
  b.onclick = () => { openTour(S.ptour); openPlayer(); };
  imgUrl(t.images[0].t).then(u => b.querySelector('img').src = u).catch(() => {});
  box.appendChild(b);
}
async function cachedCount(t) {
  const c = await caches.open(CONTENT_CACHE); const keys = new Set((await c.keys()).map(r => new URL(r.url).pathname.split('/').slice(-3).join('/')));
  let n = 0; for (const f of t.files) if (keys.has(f.split('/').slice(-3).join('/'))) n++;
  return n;
}
async function renderSave(t) {
  const box = $(`.save[data-tour="${t.id}"]`); if (!box) return;
  if (S.saving[t.id]) { box.innerHTML = `<div class="bar"><i style="width:${S.saving[t.id].pct}%"></i></div><span class="stat">저장 중… ${S.saving[t.id].pct}% (${mb(S.saving[t.id].done)} / ${mb(t.bytes)}) — 화면을 켜 두세요</span>`; return; }
  let n = 0; try { n = await cachedCount(t); } catch (e) {}
  if (n >= t.files.length) {
    box.innerHTML = `<div class="row"><span class="ok">✓ 오프라인 저장 완료 (${mb(t.bytes)})</span><button class="linkbtn del">지우기</button></div>`;
    box.querySelector('.del').onclick = () => removeTour(t);
  } else {
    box.innerHTML = `<button class="btn">⬇︎ 오프라인 저장 (${mb(t.bytes)})${n / t.files.length >= 0.01 ? ` · ${Math.round(n / t.files.length * 100)}% 받아 둠` : ''}</button>`;
    box.querySelector('button').onclick = () => saveTour(t);
  }
}
async function saveTour(t) {
  if (S.saving[t.id]) return;
  if (!navigator.onLine) { toast('인터넷에 연결된 상태에서 저장해 주세요.'); return; }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  const c = await caches.open(CONTENT_CACHE);
  const have = new Set((await c.keys()).map(r => new URL(r.url).pathname.split('/').slice(-3).join('/')));
  const sizes = {}; t.tracks.forEach(k => sizes[k.audio] = k.abytes);
  const todo = t.files.filter(f => !have.has(f.split('/').slice(-3).join('/')));
  const st = S.saving[t.id] = { done: t.bytes - todo.reduce((a, f) => a + (sizes[f] || 60000), 0), pct: 0 };
  let i = 0, fail = 0;
  const tick = () => { st.pct = Math.min(99, Math.round(st.done / t.bytes * 100)); renderSave(t); };
  tick();
  async function worker() {
    while (i < todo.length) {
      const f = todo[i++];
      for (let a = 0; a < 3; a++) {
        try { const r = await fetch(f, { cache: 'no-store' }); if (!r.ok) throw 0; const b = await r.blob(); await c.put(f, new Response(b)); st.done += b.size; break; }
        catch (e) { if (a === 2) fail++; else await new Promise(z => setTimeout(z, 1500)); }
      }
      tick();
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
  delete S.saving[t.id];
  renderSave(t);
  toast(fail ? `${fail}개 파일을 못 받았어요. 다시 눌러 주세요.` : `${t.short} 오프라인 저장 완료!`, 3500);
}
async function removeTour(t) {
  if (!confirm(`${t.short} 저장 파일을 지울까요? (${mb(t.bytes)})`)) return;
  const c = await caches.open(CONTENT_CACHE);
  const other = S.cat.tours.filter(x => x !== t).flatMap(x => x.files);
  for (const r of await c.keys()) { const p = new URL(r.url).pathname; if (t.files.some(f => p.endsWith(f)) && !other.some(f => p.endsWith(f))) await c.delete(r); }
  renderSave(t);
}
async function cleanupContent() {
  try {
    const c = await caches.open(CONTENT_CACHE); const all = S.cat.tours.flatMap(t => t.files).concat([S.cat.check]);
    for (const r of await c.keys()) { const p = new URL(r.url).pathname; if (!all.some(f => p.endsWith(f))) await c.delete(r); }
  } catch (e) {}
}

/* ---------- 투어 화면 ---------- */
function openTour(t) {
  S.tour = t; $('#tourTitle').textContent = t.title;
  show('tour');
  renderList(); initMap();
  if (S.track && S.ptour === t && S.track.station) setTimeout(() => focusStation(S.track.station, false), 60);
}
$('#backBtn').onclick = () => { stopGps(); renderHome(); show('home'); };
$('#infoBtn').onclick = () => { renderInfo(); show('info'); };
$('#infoBack').onclick = () => show('home');

function renderList() {
  const t = S.tour, box = $('#trackList'); box.innerHTML = '';
  const io = new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting) return; io.unobserve(e.target);
    imgUrl(e.target.dataset.src).then(u => e.target.style.backgroundImage = `url("${u}")`).catch(() => {});
  }), { rootMargin: '200px' });
  t.chapters.forEach((ch, ci) => {
    const sec = document.createElement('section'); sec.className = 'chapter';
    sec.innerHTML = `<h3>${ch}</h3>`;
    t.tracks.filter(k => k.chapter === ci).forEach(k => {
      const b = document.createElement('button'); b.className = 'trk'; b.dataset.id = k.id;
      b.innerHTML = `<span class="th" data-src="${k.images[0].t}"></span><span class="tt"><b>${k.code}</b><span>${k.title}</span></span><span class="du">${fmt(k.dur)}</span>`;
      b.onclick = () => { if (S.track && S.track.id === k.id) openPlayer(); else { loadTrack(k, true); openPlayer(); } };
      sec.appendChild(b); io.observe(b.querySelector('.th'));
    });
    box.appendChild(sec);
  });
  markList();
}
function markList() {
  $$('.trk').forEach(b => {
    b.classList.toggle('done', !!S.prog[b.dataset.id]?.done);
    b.classList.toggle('cur', !!S.track && S.track.id === b.dataset.id);
  });
  drawPins();
}

/* ---------- 지도 ---------- */
function initMap() {
  const t = S.tour, m = t.map;
  const bounds = L.latLngBounds([m.south, m.west], [m.north, m.east]);
  if (S.map && S.map._tourId === t.id) { setTimeout(() => S.map.invalidateSize(), 50); return; }
  if (S.map) { S.map.remove(); S.map = null; S.layers = {}; }
  const map = L.map('map', { zoomControl: false, attributionControl: true, maxBounds: bounds.pad(0.15), maxBoundsViscosity: 0.8, zoomSnap: 0.25, minZoom: 15, maxZoom: 20 });
  map._tourId = t.id;
  L.imageOverlay(m.img, bounds).addTo(map);
  map.attributionControl.setPrefix('').addAttribution('© OpenStreetMap contributors');
  const st = Object.fromEntries(t.stations.map(s => [s.id, s]));
  const line = t.route.map(r => typeof r === 'string' ? [st[r].lat, st[r].lon] : r);
  L.polyline(line, { color: '#D9A410', weight: 4, opacity: .85, dashArray: '2 8', lineCap: 'round' }).addTo(map);
  S.map = map; S.layers.pins = L.layerGroup().addTo(map);
  fitAll(false);
  drawPins();
  setTimeout(() => map.invalidateSize(), 80);
}
function fitAll(anim = true) {
  const t = S.tour; const pts = t.stations.filter(s => s.tracks.length).map(s => [s.lat, s.lon]);
  S.map.fitBounds(L.latLngBounds(pts).pad(0.08), { animate: anim });
}
$('#fitBtn').onclick = () => fitAll();
function stationNo(t) {
  const order = {}; let n = 0; t.route.forEach(r => { if (typeof r === 'string') order[r] = ++n; });
  return order;
}
function drawPins() {
  if (!S.map || !S.tour) return;
  const t = S.tour, g = S.layers.pins; g.clearLayers();
  const order = stationNo(t);
  for (const s of t.stations) {
    const done = s.tracks.length && s.tracks.every(id => S.prog[id]?.done);
    const cur = S.track && s.tracks.includes(S.track.id);
    const label = order[s.id] || (s.tracks.length ? '·' : '★');
    const cls = 'pin' + (cur ? ' cur' : done ? ' done' : '') + (s.tracks.length ? '' : ' extra');
    const mk = L.marker([s.lat, s.lon], { icon: L.divIcon({ className: '', html: `<div class="${cls}">${label}</div>`, iconSize: [28, 28], iconAnchor: [14, 14] }), zIndexOffset: cur ? 1000 : 0 });
    mk.bindPopup(() => popupHtml(s), { closeButton: false, autoPanPadding: [20, 20] });
    mk._sid = s.id; g.addLayer(mk);
  }
}
function popupHtml(s) {
  const d = document.createElement('div'); d.className = 'pop';
  d.innerHTML = `<b>${s.name}</b>`;
  if (!s.tracks.length) d.innerHTML += '<span class="muted">참고 위치</span>';
  s.tracks.forEach(id => {
    const k = S.tour.tracks.find(x => x.id === id);
    const b = document.createElement('button'); b.innerHTML = `<span>${k.code}</span>${k.title}${S.prog[id]?.done ? ' ✓' : ''}`;
    b.onclick = () => { S.map.closePopup(); loadTrack(k, true); openPlayer(); };
    d.appendChild(b);
  });
  return d;
}
function focusStation(sid, popup = true) {
  if (!S.map) return; const s = S.tour.stations.find(x => x.id === sid); if (!s) return;
  S.map.setView([s.lat, s.lon], Math.max(S.map.getZoom(), 18), { animate: true });
  if (popup) S.layers.pins.eachLayer(l => { if (l._sid === sid) l.openPopup(); });
}

/* ---------- GPS ---------- */
$('#gpsBtn').onclick = () => S.gpsWatch == null ? startGps() : stopGps();
function startGps() {
  if (!navigator.geolocation) { toast('이 기기에서는 위치를 쓸 수 없어요.'); return; }
  $('#gpsBtn').setAttribute('aria-pressed', 'true');
  toast('위치를 찾는 중… (인터넷 없이도 GPS는 돼요)');
  let first = true;
  S.gpsWatch = navigator.geolocation.watchPosition(p => {
    S.gps = p.coords; drawGps(); if (first) { first = false; centerGps(); } updateNear();
  }, err => {
    toast(err.code === 1 ? '위치 권한이 꺼져 있어요. 설정 > 개인정보 보호 > 위치 서비스에서 켜 주세요.' : '위치를 아직 못 찾았어요. 하늘이 보이는 곳에서 다시 해 보세요.', 4000);
    if (err.code === 1) stopGps();
  }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
}
function stopGps() {
  if (S.gpsWatch != null) navigator.geolocation.clearWatch(S.gpsWatch);
  S.gpsWatch = null; S.gps = null; $('#gpsBtn').setAttribute('aria-pressed', 'false');
  if (S.layers.gps) { S.layers.gps.remove(); S.layers.gps = null; }
  $('#near').hidden = true;
}
function drawGps() {
  if (!S.map || !S.gps) return;
  const ll = [S.gps.latitude, S.gps.longitude];
  if (!S.layers.gps) {
    S.layers.gps = L.layerGroup([
      L.circle(ll, { radius: S.gps.accuracy, color: '#1E6FD9', weight: 1, fillOpacity: .12 }),
      L.marker(ll, { icon: L.divIcon({ className: '', html: '<div class="gpsdot"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }), interactive: false, zIndexOffset: 2000 }),
    ]).addTo(S.map);
  } else {
    S.layers.gps.eachLayer(l => { l.setLatLng(ll); if (l.setRadius) l.setRadius(S.gps.accuracy); });
  }
}
function centerGps() {
  const m = S.tour.map, la = S.gps.latitude, lo = S.gps.longitude;
  if (la < m.south || la > m.north || lo < m.west || lo > m.east) return;
  S.map.setView([la, lo], Math.max(S.map.getZoom(), 17.5));
}
function dist(a, b, c, d) { const R = 6371000, r = Math.PI / 180; const x = (d - b) * r * Math.cos((a + c) / 2 * r), y = (c - a) * r; return Math.sqrt(x * x + y * y) * R; }
function updateNear() {
  const box = $('#near'); if (!S.gps || !S.tour) { box.hidden = true; return; }
  const la = S.gps.latitude, lo = S.gps.longitude;
  let best = null;
  for (const s of S.tour.stations) { if (!s.tracks.length) continue; const d = dist(la, lo, s.lat, s.lon); if (!best || d < best.d) best = { s, d }; }
  if (!best) return;
  box.hidden = false;
  if (best.d > 1500) { box.innerHTML = `<span class="t">지금 위치는 이 투어 지도에서 약 ${(best.d / 1000).toFixed(1)}km 떨어져 있어요.</span>`; return; }
  const next = best.s.tracks.map(id => S.tour.tracks.find(k => k.id === id)).find(k => !S.prog[k.id]?.done) || S.tour.tracks.find(k => k.id === best.s.tracks[0]);
  box.innerHTML = `<span class="t">${best.d < 60 ? '여기' : `약 ${Math.round(best.d)}m 거리`}: <b>${best.s.name}</b><br><span class="muted">${next.code} ${next.title}</span></span><button class="btn primary">▶</button>`;
  box.querySelector('button').onclick = () => { loadTrack(next, true); openPlayer(); };
}

/* ---------- 재생 ---------- */
let loadSeq = 0;
async function loadTrack(k, play) {
  const seq = ++loadSeq;
  if (S.track && S.track.id !== k.id) saveProg();
  const [tour] = trackById(k.id); S.ptour = tour; S.track = k; LS.set('last', k.id);
  S.follow = true; S.imgIdx = -1; S.paraOn = -1;
  renderPlayerStatic();
  markList(); renderMini();
  try {
    const u = await blobUrl(k.audio, 'audio/mpeg');
    if (seq !== loadSeq) return;
    audio.src = u; audio.playbackRate = S.speed; audio.defaultPlaybackRate = S.speed;
    const p = S.prog[k.id];
    const startAt = p && !p.done && p.pos > 5 && p.pos < k.dur - 5 ? p.pos : 0;
    audio.addEventListener('loadedmetadata', () => { if (startAt) audio.currentTime = startAt; }, { once: true });
    if (play) await audio.play().catch(() => {});
    pruneUrls();
  } catch (e) {
    toast(navigator.onLine ? '오디오를 불러오지 못했어요.' : '아직 저장하지 않은 트랙이에요. 인터넷이 될 때 오프라인 저장을 해 주세요.', 4000);
  }
  setSession();
}
function pruneUrls() {
  // 오디오 Blob URL은 지금 트랙만 남긴다 (메모리 절약)
  for (const [rel, p] of [...S.urls]) if (/^c\/[VC]\/a/.test(rel) && S.track && rel !== S.track.audio) { p.then(u => URL.revokeObjectURL(u)).catch(() => {}); S.urls.delete(rel); }
}
function saveProg() {
  if (!S.track || !isFinite(audio.currentTime)) return;
  const p = S.prog[S.track.id] || {}; p.pos = audio.currentTime; S.prog[S.track.id] = p; LS.set('prog', S.prog);
}
audio.addEventListener('timeupdate', () => {
  const k = S.track; if (!k) return;
  const d = audio.duration || k.dur, c = audio.currentTime;
  if (!S.dragging) { $('#seek').value = Math.round(c / d * 1000); $('#tCur').textContent = fmt(c); }
  $('#miniBar i').style.width = (c / d * 100) + '%';
  const f = c / d;
  if (S.follow) { let idx = 0; k.images.forEach((im, i) => { if (im.at <= f + 0.004) idx = i; }); if (idx !== S.imgIdx) showImg(idx, true); }
  updatePara(f);
  if (!S._lastSave || Date.now() - S._lastSave > 5000) { S._lastSave = Date.now(); saveProg(); }
  if (!S.prog[k.id]?.done && f > 0.97) { S.prog[k.id] = { ...(S.prog[k.id] || {}), done: true }; LS.set('prog', S.prog); markList(); }
});
audio.addEventListener('loadedmetadata', () => { $('#tDur').textContent = fmt(audio.duration); });
audio.addEventListener('play', () => setPlayIcon(true));
audio.addEventListener('pause', () => { setPlayIcon(false); saveProg(); });
audio.addEventListener('ended', () => {
  const k = S.track; S.prog[k.id] = { done: true, pos: 0 }; LS.set('prog', S.prog); markList();
  if (S.auto) { const n = neighbor(1); if (n) loadTrack(n, true); }
  else { const n = neighbor(1); if (n) toast(`다음: ${n.code} ${n.title}`, 3500); }
});
function setPlayIcon(on) { $('#bPlay').textContent = on ? '❚❚' : '▶'; $('#miniPlay').textContent = on ? '❚❚' : '▶'; $('#bPlay').setAttribute('aria-label', on ? '일시정지' : '재생'); }
function toggle() { if (!audio.src) { if (S.track) loadTrack(S.track, true); return; } audio.paused ? audio.play().catch(() => {}) : audio.pause(); }
function neighbor(dir) { const t = S.ptour, i = t.tracks.indexOf(S.track); return t.tracks[i + dir] || null; }
function seekBy(s) { audio.currentTime = Math.max(0, Math.min((audio.duration || 0) - 0.5, audio.currentTime + s)); }
$('#bPlay').onclick = toggle; $('#miniPlay').onclick = e => { e.stopPropagation(); toggle(); };
$('#bBack').onclick = () => seekBy(-15); $('#bFwd').onclick = () => seekBy(15);
$('#bPrev').onclick = () => { if (audio.currentTime > 4) { audio.currentTime = 0; return; } const n = neighbor(-1); if (n) loadTrack(n, true); };
$('#bNext').onclick = () => { const n = neighbor(1); if (n) loadTrack(n, true); };
$('#seek').addEventListener('input', () => { S.dragging = true; const d = audio.duration || S.track.dur; $('#tCur').textContent = fmt($('#seek').value / 1000 * d); });
$('#seek').addEventListener('change', () => { const d = audio.duration || S.track.dur; audio.currentTime = $('#seek').value / 1000 * d; S.dragging = false; });
const SPEEDS = [1, 1.2, 1.5, 0.8];
function setSpeedLabel() { $('#speedBtn').textContent = S.speed.toFixed(1) + '×'; }
$('#speedBtn').onclick = () => { S.speed = SPEEDS[(SPEEDS.indexOf(S.speed) + 1) % SPEEDS.length]; audio.playbackRate = S.speed; LS.set('speed', S.speed); setSpeedLabel(); };
function setAutoLabel() { $('#autoBtn').setAttribute('aria-pressed', S.auto); $('#autoBtn').textContent = S.auto ? '연속 재생 켬' : '연속 재생 끔'; }
$('#autoBtn').onclick = () => { S.auto = !S.auto; LS.set('auto', S.auto); setAutoLabel(); toast(S.auto ? '트랙이 끝나면 다음 트랙을 바로 틀어요.' : '트랙이 끝나면 멈춰요. 다음 장소에서 직접 눌러 주세요.'); };

/* ---------- 플레이어 화면 ---------- */
function openPlayer() { $('#player').classList.add('open'); $('#player').setAttribute('aria-hidden', 'false'); $('#mini').hidden = true; }
function closePlayer() { $('#player').classList.remove('open'); $('#player').setAttribute('aria-hidden', 'true'); renderMini(); }
$('#pClose').onclick = closePlayer;
$('#mini').onclick = openPlayer;
$('#pMap').onclick = () => { closePlayer(); if (!S.track) return; if ($('#tour').hidden || S.tour !== S.ptour) openTour(S.ptour); if (S.track.station) focusStation(S.track.station); else toast('이 트랙은 어디서 들어도 되는 트랙이에요.'); };
function renderMini() {
  const k = S.track; $('#mini').hidden = !k || $('#player').classList.contains('open') || !$('#lock').hidden;
  if (!k) return;
  $('#miniCode').textContent = `${S.ptour.short} ${k.code}`; $('#miniTitle').textContent = k.title;
  imgUrl(k.images[0].t).then(u => $('#miniImg').src = u).catch(() => {});
}
async function renderPlayerStatic() {
  const k = S.track, t = S.ptour;
  $('#pChapter').textContent = t.chapters[k.chapter];
  $('#pCode').textContent = k.code; $('#pTitle').textContent = k.title;
  $('#tDur').textContent = fmt(k.dur); $('#tCur').textContent = '0:00'; $('#seek').value = 0;
  setSpeedLabel(); setAutoLabel();
  // 사진 슬라이드
  const sl = $('#slides'); sl.innerHTML = ''; $('#dots').innerHTML = '';
  k.images.forEach((im, i) => {
    const f = document.createElement('figure'); const img = document.createElement('img'); img.alt = im.cap; img.dataset.i = i;
    img.onclick = () => openViewer(i); img.onload = () => img.classList.add('on');
    f.appendChild(img); sl.appendChild(f);
    $('#dots').appendChild(document.createElement('i'));
    imgUrl(im.f).then(u => { img.src = u; }).catch(() => imgUrl(im.t).then(u => { img.src = u; img.classList.add('on'); }));
  });
  $('#dots').hidden = k.images.length < 2;
  showImg(0, false);
  // 대본
  const box = $('#tab-script'); box.innerHTML = '<p class="muted">불러오는 중…</p>';
  try {
    const texts = await getTexts(t); const paras = texts[k.id] || [];
    if (S.track !== k) return;
    box.innerHTML = ''; let acc = 0; const total = paras.reduce((a, p) => a + p.length, 0) || 1; S.paraEnds = [];
    paras.forEach(p => { const el = document.createElement('p'); el.textContent = p; box.appendChild(el); acc += p.length; S.paraEnds.push(acc / total); });
    S.paraOn = -1; updatePara(audio.currentTime / (audio.duration || k.dur) || 0);
  } catch (e) { box.innerHTML = '<p class="muted">대본을 불러오지 못했어요.</p>'; }
  // 사진 탭
  const g = $('#tab-photos'); g.innerHTML = '<div class="grid"></div>';
  k.images.forEach((im, i) => { const b = document.createElement('button'); b.setAttribute('aria-label', im.cap); b.onclick = () => openViewer(i); g.firstChild.appendChild(b); imgUrl(im.t).then(u => b.style.backgroundImage = `url("${u}")`).catch(() => {}); });
  // 자료 탭
  const inf = $('#tab-info'); inf.innerHTML = '';
  const list = document.createElement('div'); list.className = 'info-list';
  if (k.station) { const s = t.stations.find(x => x.id === k.station); const b = document.createElement('button'); b.className = 'pill'; b.textContent = `📍 듣는 곳: ${s.name} — 지도에서 보기`; b.onclick = () => $('#pMap').onclick(); list.appendChild(b); }
  else list.insertAdjacentHTML('beforeend', '<p class="muted">📍 어디서 들어도 되는 트랙이에요. 가는 길이나 줄 서는 동안 들어 두세요.</p>');
  k.links.forEach(([label, url]) => list.insertAdjacentHTML('beforeend', `<a href="${url}" target="_blank" rel="noopener">🔗 ${label}</a>`));
  list.insertAdjacentHTML('beforeend', '<h4 style="margin:10px 0 0">사진 정보</h4>');
  k.images.forEach(im => list.insertAdjacentHTML('beforeend', `<div class="credit"><b>${im.cap}</b><br>${creditText(im.credit)}</div>`));
  inf.appendChild(list);
}
function creditText(c) {
  if (c.src !== 'Wikimedia Commons') return c.src;
  return `${c.artist ? c.artist + ' · ' : ''}${c.lic || ''} · <a href="${c.page}" target="_blank" rel="noopener">Wikimedia Commons</a>`;
}
function showImg(i, fromAudio) {
  const k = S.track; if (!k || !k.images[i]) return;
  S.imgIdx = i;
  const sl = $('#slides'); const fig = sl.children[i];
  if (fig) { S._progScroll = true; sl.scrollTo({ left: fig.offsetLeft, behavior: fromAudio ? 'smooth' : 'auto' }); setTimeout(() => S._progScroll = false, 600); }
  $$('#dots i').forEach((d, j) => d.classList.toggle('on', j === i));
  $('#caption').textContent = k.images[i].cap;
  if ('mediaSession' in navigator) setSession();
}
$('#slides').addEventListener('scroll', () => {
  const sl = $('#slides'); const i = Math.round(sl.scrollLeft / sl.clientWidth);
  if (S._progScroll) return;
  if (i !== S.imgIdx) { S.follow = false; $('#followChip').hidden = false; S.imgIdx = i; $$('#dots i').forEach((d, j) => d.classList.toggle('on', j === i)); $('#caption').textContent = S.track.images[i]?.cap || ''; }
}, { passive: true });
$('#followChip').onclick = () => { S.follow = true; $('#followChip').hidden = true; S.imgIdx = -1; audio.dispatchEvent(new Event('timeupdate')); };
function updatePara(f) {
  if (!S.paraEnds.length) return;
  let i = S.paraEnds.findIndex(e => f <= e); if (i < 0) i = S.paraEnds.length - 1;
  if (i === S.paraOn) return; S.paraOn = i;
  const ps = $$('#tab-script p'); ps.forEach((p, j) => p.classList.toggle('on', j === i));
  // 사진이 가려지지 않게: 사용자가 대본 쪽으로 내려 읽고 있을 때만 따라 내려간다
  const pl = $('#player');
  if (!$('#tab-script').hidden && pl.classList.contains('open') && !audio.paused && ps[i] && !S.userScrolling && pl.scrollTop > $('#stage').offsetHeight * 0.8) ps[i].scrollIntoView({ block: 'center', behavior: 'smooth' });
}
$('#player').addEventListener('touchstart', () => { S.userScrolling = true; clearTimeout(S._us); }, { passive: true });
$('#player').addEventListener('touchend', () => { clearTimeout(S._us); S._us = setTimeout(() => S.userScrolling = false, 6000); }, { passive: true });
$$('.tabs button').forEach(b => b.onclick = () => {
  $$('.tabs button').forEach(x => x.setAttribute('aria-selected', x === b));
  ['script', 'photos', 'info'].forEach(n => $('#tab-' + n).hidden = n !== b.dataset.tab);
});

/* ---------- 사진 크게 보기 (핀치 줌) ---------- */
const V = { s: 1, x: 0, y: 0, pts: new Map() };
async function openViewer(i) {
  const im = S.track.images[i]; $('#viewer').hidden = false; $('#vCap').textContent = im.cap;
  const img = $('#vImg'); img.src = await imgUrl(im.f).catch(() => imgUrl(im.t)); resetZoom();
}
$('#vClose').onclick = () => { $('#viewer').hidden = true; };
function resetZoom() { V.s = 1; V.x = 0; V.y = 0; applyZoom(); }
function applyZoom() { $('#vImg').style.transform = `translate(${V.x}px,${V.y}px) scale(${V.s})`; $('#vImg').style.transformOrigin = 'center center'; }
(function () {
  const st = $('#vStage'); let last = null, lastTap = 0, start = null;
  st.addEventListener('pointerdown', e => { st.setPointerCapture(e.pointerId); V.pts.set(e.pointerId, [e.clientX, e.clientY]); if (V.pts.size === 2) { const [a, b] = [...V.pts.values()]; start = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), s: V.s }; } last = [e.clientX, e.clientY];
    const now = Date.now(); if (V.pts.size === 1 && now - lastTap < 280) { V.s = V.s > 1 ? 1 : 2.5; if (V.s === 1) { V.x = 0; V.y = 0; } applyZoom(); } lastTap = now; });
  st.addEventListener('pointermove', e => {
    if (!V.pts.has(e.pointerId)) return; V.pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (V.pts.size === 2 && start) { const [a, b] = [...V.pts.values()]; V.s = Math.min(6, Math.max(1, start.s * Math.hypot(a[0] - b[0], a[1] - b[1]) / start.d)); if (V.s === 1) { V.x = 0; V.y = 0; } applyZoom(); }
    else if (V.pts.size === 1 && V.s > 1 && last) { V.x += e.clientX - last[0]; V.y += e.clientY - last[1]; applyZoom(); }
    last = [e.clientX, e.clientY];
  });
  const up = e => { V.pts.delete(e.pointerId); if (V.pts.size < 2) start = null; if (V.pts.size === 1) last = [...V.pts.values()][0]; };
  st.addEventListener('pointerup', up); st.addEventListener('pointercancel', up);
})();

/* ---------- 잠금 화면 · 미디어 세션 ---------- */
function setSession() {
  if (!('mediaSession' in navigator) || !S.track) return;
  const k = S.track;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({ title: `${k.code} ${k.title}`, artist: '코미꼬', album: S.ptour.title, artwork: [{ src: 'icon-512.png', sizes: '512x512', type: 'image/png' }] });
    const h = (a, f) => { try { navigator.mediaSession.setActionHandler(a, f); } catch (e) {} };
    h('play', () => audio.play()); h('pause', () => audio.pause());
    h('seekbackward', () => seekBy(-15)); h('seekforward', () => seekBy(15));
    h('previoustrack', () => $('#bPrev').onclick()); h('nexttrack', () => $('#bNext').onclick());
    h('seekto', d => { audio.currentTime = d.seekTime; });
  } catch (e) {}
}

/* ---------- 정보 ---------- */
function renderInfo() {
  const box = $('#infoBody'); const seen = new Set(); let rows = '';
  for (const t of S.cat.tours) for (const k of t.tracks) for (const im of k.images) {
    const c = im.credit; if (c.src !== 'Wikimedia Commons' || seen.has(c.page)) continue; seen.add(c.page);
    rows += `<div class="credit"><b>${c.title}</b><br>${creditText(c)}</div>`;
  }
  box.innerHTML = `
  <div><h3>사용법</h3><p class="muted">① 숙소 와이파이에서 투어마다 <b>오프라인 저장</b>을 눌러 두세요.<br>② 현장에서는 지도 위 번호를 누르거나, <b>내 위치</b>를 켜고 가까운 트랙을 누르면 돼요.<br>③ 사진은 이야기 흐름에 맞춰 저절로 넘어가요. 옆으로 넘기면 자동 넘김이 멈추고, 사진을 누르면 크게 볼 수 있어요.</p></div>
  <div><h3>지도</h3><p class="credit">지도 데이터 © OpenStreetMap contributors (ODbL). 실내에서는 GPS가 몇십 미터씩 틀릴 수 있어요.</p></div>
  <div><h3>사진 출처 (Wikimedia Commons)</h3><div class="info-list">${rows}</div><p class="credit">그 밖의 사진은 투어 준비용 참고자료에서 가져왔어요.</p></div>
  <div><h3>이 폰에서 비밀번호 지우기</h3><button class="btn" id="forget">비밀번호 다시 넣기</button></div>`;
  $('#forget').onclick = () => { LS.del('key'); location.reload(); };
}

document.addEventListener('visibilitychange', () => { if (document.hidden) saveProg(); });
boot();
