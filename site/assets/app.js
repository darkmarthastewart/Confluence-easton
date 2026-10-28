// Confluence Easton app. Reads everything from /data/*.json; no build step.
(function () {
  'use strict';

  const TZ = 'America/New_York';
  const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const CENTRE = [40.6912, -75.2091];
  const TYPES = {
    landmark: { label: 'Landmarks', color: '--ink' },
    food: { label: 'Food & drink', color: '--brick' },
    shop: { label: 'Shops', color: '--river' },
    creative: { label: 'Creative', color: '--plum' },
    outdoors: { label: 'Outdoors', color: '--moss' }
  };
  const TABS = { today: 'Today', events: 'Events', map: 'Map', directory: 'Directory', guides: 'Day & Night' };
  const ICONS = {
    today: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    events: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    map: '<path d="M9 4l6 2 6-2v16l-6 2-6-2-6 2V6z"/><path d="M9 4v16M15 6v16"/>',
    directory: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    guides: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>'
  };

  const S = { tab: 'today', evCat: 'all', seg: 'businesses', dirCat: 'all', q: '', mapCat: 'all', sel: null, route: null, guide: null, pick: false };
  let places = [], P = {}, events = [], artists = [], guides = [], G = {}, occurrences = [];
  let saved = new Set();
  try { saved = new Set(JSON.parse(localStorage.getItem('confluence-plan') || '[]')); } catch (e) {}
  const persist = () => { try { localStorage.setItem('confluence-plan', JSON.stringify([...saved])); } catch (e) {} };

  /* ---------- time in Easton ---------- */
  function eastonNow() {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short'
    }).formatToParts(new Date()).map(p => [p.type, p.value]));
    return {
      ymd: `${parts.year}-${parts.month}-${parts.day}`,
      dow: DAY_NAMES.indexOf(parts.weekday),
      min: Number(parts.hour) * 60 + Number(parts.minute)
    };
  }
  const NOW = eastonNow();
  const ymdDate = ymd => { const [y, m, d] = ymd.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
  const addDays = (ymd, n) => { const d = ymdDate(ymd); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const dowOf = ymd => ymdDate(ymd).getUTCDay();
  function dayLabel(ymd) {
    const d = ymdDate(ymd), base = `${DAY_NAMES[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
    if (ymd === NOW.ymd) return 'Today · ' + base;
    if (ymd === addDays(NOW.ymd, 1)) return 'Tomorrow · ' + base;
    return base;
  }
  const toMin = hm => { const [h, m] = hm.split(':').map(Number); return h * 60 + (m || 0); };
  function fmt(hm) {
    const v = typeof hm === 'number' ? hm : toMin(hm);
    let h = Math.floor(v / 60) % 24; const m = v % 60, ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return m ? `${h}:${String(m).padStart(2, '0')} ${ap}` : `${h} ${ap}`;
  }

  /* ---------- hours ---------- */
  function rangesFor(p, dow) {
    if (!p.hours) return null;
    const s = p.hours[DAYS[dow]] ?? p.hours.default;
    if (!s || s === 'closed') return [];
    return s.split(',').map(r => { const [a, b] = r.trim().split('-'); let o = toMin(a), c = toMin(b); if (c <= o) c += 1440; return [o, c]; });
  }
  function openState(p) {
    const today = rangesFor(p, NOW.dow);
    if (today === null) return null;
    const yest = rangesFor(p, (NOW.dow + 6) % 7) || [];
    for (const [o, c] of yest) if (c > 1440 && NOW.min < c - 1440) return { open: true, txt: 'Open till ' + fmt(c - 1440) };
    for (const [o, c] of today) if (NOW.min >= o && NOW.min < c) return { open: true, txt: 'Open till ' + fmt(c) };
    const next = today.find(([o]) => o > NOW.min);
    if (next) return { open: false, txt: 'Opens ' + fmt(next[0]) };
    return { open: false, txt: today.length ? 'Closed now' : 'Closed today' };
  }
  function hoursText(p) {
    if (!p.hours) return '';
    const lines = [];
    let i = 1;
    const order = [1, 2, 3, 4, 5, 6, 0];
    const label = d => { const r = rangesFor(p, d); return r.length ? r.map(([o, c]) => `${fmt(o)}–${fmt(c)}`).join(', ') : 'Closed'; };
    let start = order[0], prev = label(start);
    for (i = 1; i <= order.length; i++) {
      const d = order[i], cur = i < order.length ? label(d) : null;
      if (cur !== prev) {
        const end = order[i - 1];
        lines.push(`${DAY_NAMES[start]}${end !== start ? '–' + DAY_NAMES[end] : ''}: ${prev}`);
        start = d; prev = cur;
      }
    }
    return lines.join('<br>');
  }

  /* ---------- events ---------- */
  function expandEvents(days) {
    const out = [];
    for (let i = 0; i < days; i++) {
      const ymd = addDays(NOW.ymd, i), dow = dowOf(ymd), month = Number(ymd.slice(5, 7));
      for (const ev of events) {
        let hit = false;
        if (ev.repeat) {
          const r = ev.repeat;
          hit = r.weekdays.includes(DAYS[dow]) && (!r.months || r.months.includes(month)) &&
            (!r.from || ymd >= r.from) && (!r.until || ymd <= r.until);
        } else if (ev.date) hit = ev.date === ymd;
        else if (typeof ev.inDays === 'number') hit = ev.inDays === i;
        if (!hit) continue;
        const start = ev.repeat ? ev.repeat.start : ev.start, end = ev.repeat ? ev.repeat.end : ev.end;
        if (i === 0 && end && toMin(end) <= NOW.min) continue; // already over today
        out.push({ ...ev, key: `${ev.id}@${ymd}`, ymd, start, end });
      }
    }
    return out.sort((a, b) => (a.ymd + a.start).localeCompare(b.ymd + b.start));
  }

  /* ---------- helpers ---------- */
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const initials = n => n.replace(/&/g, '').split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join('');
  const exTag = x => x.example ? ' <span class="example">Example</span>' : '';
  const pill = p => { const o = openState(p); return o ? `<span class="pill ${o.open ? 'open' : 'closed'}">${esc(o.txt)}</span>` : ''; };
  const dirLink = (addr, kind) => kind === 'apple'
    ? 'https://maps.apple.com/?daddr=' + encodeURIComponent(addr)
    : 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(addr);
  function artSVG(colors, seed) {
    let r = seed; const rnd = () => (r = (r * 9301 + 49297) % 233280) / 233280;
    let shapes = '';
    for (let i = 0; i < 5; i++) {
      const c = colors[i % 3], x = rnd() * 80, y = rnd() * 80, s = 20 + rnd() * 40;
      shapes += i % 2 ? `<circle cx="${x + 10}" cy="${y + 10}" r="${s / 2}" fill="${c}"/>`
        : `<rect x="${x}" y="${y}" width="${s}" height="${s * 0.7}" fill="${c}" transform="rotate(${rnd() * 40 - 20} ${x} ${y})"/>`;
    }
    return `<svg class="art" viewBox="0 0 100 100" aria-hidden="true"><rect width="100" height="100" fill="${colors[2]}"/>${shapes}</svg>`;
  }
  const artistArt = a => a.photo ? `<img class="art" src="${esc(a.photo)}" alt="">` : artSVG(a.colors || ['#1D6683', '#E5A91A', '#13232B'], a.name.length * 97);

  /* ---------- rows & cards ---------- */
  function evRow(o) {
    const p = P[o.place];
    return `<button class="row" type="button" data-ev="${esc(o.key)}">
      <div class="time">${fmt(o.start)}${o.end ? `<small>${fmt(o.end)}</small>` : ''}</div>
      <div style="min-width:0"><div class="row-title">${esc(o.title)}</div><div class="row-sub">${esc(p ? p.name : '')}</div></div>
      <div class="row-end">${saved.has(o.key) ? '<span class="saved">Saved</span>' : (o.free ? '<span class="tag free">Free</span>' : `<span class="tag">${esc(o.price || '')}</span>`)}${o.example ? '<span class="example">Example</span>' : ''}</div>
    </button>`;
  }
  function placeRow(p) {
    const thumb = p.photo ? `<img class="thumb" src="${esc(p.photo)}" alt="" style="object-fit:cover">`
      : `<div class="thumb" style="background:var(${TYPES[p.type].color})">${esc(initials(p.name))}</div>`;
    const sub = p.type === 'creative' && p.tags ? p.tags.join(' · ') : p.sub + (p.price ? ' · ' + p.price : '');
    return `<button class="row" type="button" data-place="${esc(p.id)}">${thumb}
      <div style="min-width:0"><div class="row-title">${esc(p.name)}</div><div class="row-sub">${esc(sub)}</div></div>
      <div class="row-end">${pill(p)}${p.example ? '<span class="example">Example</span>' : ''}</div></button>`;
  }
  const styleCls = { night: 'g-night', day: 'g-day', warm: 'g-warm', art: 'g-art' };
  const guideCard = g => `<button class="gcard ${styleCls[g.style] || 'g-day'}" type="button" data-guide="${esc(g.id)}">
      <div><div class="k">${g.when === 'night' ? 'Night' : 'Day'} · ${esc(g.who)}</div><div class="t">${esc(g.title)}</div></div>
      <div class="m">${g.stops.length} stops · ${esc(g.time)}</div></button>`;
  const artistCard = (a, feature) => `<button class="artist" type="button" data-artist="${esc(a.id)}">${artistArt(a)}
      <div style="min-width:0">${feature ? '<div class="label">Featured artist</div>' : ''}
      <div class="who">${esc(a.name)}${exTag(a)}</div><div class="med">${esc(a.medium)}</div>${feature ? `<p>${esc(a.bio)}</p>` : ''}</div></button>`;

  /* ---------- screens ---------- */
  function today() {
    const h = Math.floor(NOW.min / 60);
    const hello = h < 5 ? 'Still up, Easton?' : h < 12 ? 'Morning, Easton.' : h < 17 ? 'Afternoon, Easton.' : h < 22 ? 'Evening, Easton.' : 'Still up, Easton?';
    const todays = occurrences.filter(o => o.ymd === NOW.ymd);
    const upcoming = todays.length ? todays : occurrences.slice(0, 4);
    const mine = occurrences.filter(o => saved.has(o.key));
    const openFood = places.filter(p => p.type === 'food' && openState(p)?.open).slice(0, 4);
    const featured = artists.find(a => a.featured) || artists[0];
    return `
    <div class="notice"><div>We're just getting started, so you'll see a few <span class="example">Example</span> listings while the real ones come in. Run a business, make things or put on events? <a href="/join/">Get on the map, free</a>.</div></div>
    <h2 class="title">${hello}</h2><p class="subtitle">${dayLabel(NOW.ymd).replace('Today · ', '')} · Here's what's on downtown.</p>
    ${mine.length ? `<h3 class="sec">Your plan</h3><div class="list">${mine.map(evRow).join('')}</div>` : ''}
    <h3 class="sec">${todays.length ? 'On today' : 'Coming up'} <a href="#events">See everything</a></h3>
    <div class="list">${upcoming.length ? upcoming.map(evRow).join('') : '<p class="empty">Quiet week on the calendar so far. Wander anyway; downtown has a way of surprising you.</p>'}</div>
    ${guides.length ? `<h3 class="sec">Make a day of it <a href="#guides">See all</a></h3><div class="hcards">${guides.map(guideCard).join('')}</div>` : ''}
    ${featured ? `<h3 class="sec">Someone you should know</h3>${artistCard(featured, true)}` : ''}
    ${openFood.length ? `<h3 class="sec">Open right now <a href="#directory">Directory</a></h3><div class="list">${openFood.map(placeRow).join('')}</div>` : ''}`;
  }

  function eventsScreen() {
    const cats = [['all', 'All'], ['music', 'Music'], ['art', 'Art'], ['family', 'Family'], ['food', 'Food'], ['free', 'Free']];
    const list = occurrences.filter(o => S.evCat === 'all' || (S.evCat === 'free' ? o.free : (o.cats || []).includes(S.evCat)));
    const days = [...new Set(list.map(o => o.ymd))];
    return `<h2 class="title">What's on</h2><p class="subtitle">The next two weeks, from the Circle down to the river.</p>
    <div class="chips" role="group" aria-label="Filter events" style="margin-top:10px">${cats.map(([k, l]) => `<button class="chip" type="button" data-evcat="${k}" aria-pressed="${S.evCat === k}">${l}</button>`).join('')}</div>
    ${days.length ? days.map(d => `<div class="day">${dayLabel(d)}</div><div class="list">${list.filter(o => o.ymd === d).map(evRow).join('')}</div>`).join('') : '<p class="empty">Nothing like that on the calendar yet. Try another, or check back soon.</p>'}
    <p class="empty">Putting something on? <a href="/join/#event">Add your event, free</a>.</p>`;
  }

  function directory() {
    const segs = [['businesses', 'Businesses'], ['creatives', 'Creatives'], ['artists', 'Artists']];
    const q = S.q.trim().toLowerCase();
    const match = (...f) => !q || f.join(' ').toLowerCase().includes(q);
    const ph = { businesses: 'Search shops, food, coffee', creatives: 'Search services, e.g. logo, portraits', artists: 'Search artists or mediums' }[S.seg];
    let body = '';
    if (S.seg === 'businesses') {
      const cats = [['all', 'All'], ['food', 'Food & drink'], ['shop', 'Shops'], ['landmark', 'Landmarks'], ['open', 'Open now']];
      const list = places.filter(p => ['food', 'shop', 'landmark', 'outdoors'].includes(p.type) &&
        (S.dirCat === 'all' || (S.dirCat === 'open' ? openState(p)?.open : S.dirCat === 'landmark' ? (p.type === 'landmark' || p.type === 'outdoors') : p.type === S.dirCat)) &&
        match(p.name, p.sub, p.blurb));
      body = `<div class="chips">${cats.map(([k, l]) => `<button class="chip" type="button" data-dircat="${k}" aria-pressed="${S.dirCat === k}">${l}</button>`).join('')}</div>
        <div class="list">${list.length ? list.map(placeRow).join('') : '<p class="empty">Nobody by that name yet. Try another word.</p>'}</div>`;
    } else if (S.seg === 'creatives') {
      const list = places.filter(p => p.type === 'creative' && match(p.name, p.sub, p.blurb, (p.tags || []).join(' ')));
      body = `<p class="subtitle" style="margin:0 0 6px;font-size:14px">The photographers, designers, printers and players who make Easton look and sound like Easton. Hire local.</p>
        <div class="list">${list.length ? list.map(placeRow).join('') : '<p class="empty">Nobody by that name yet. Try another word.</p>'}</div>`;
    } else {
      const list = artists.filter(a => match(a.name, a.medium, a.bio));
      body = `<div class="stack">${list.length ? list.map(a => artistCard(a, false)).join('') : '<p class="empty">Nobody by that name yet. Try another word.</p>'}</div>`;
    }
    return `<h2 class="title">Around town</h2>
      <div class="seg" role="group" aria-label="Directory section">${segs.map(([k, l]) => `<button type="button" data-seg="${k}" aria-pressed="${S.seg === k}">${l}</button>`).join('')}</div>
      <input class="search" id="dirsearch" type="search" placeholder="${ph}" value="${esc(S.q)}" aria-label="${ph}">
      ${body}
      <p class="empty">Someone missing? <a href="/join/">Add a listing, free</a>, or send them the link.</p>`;
  }

  function guidesScreen() {
    if (S.guide && G[S.guide]) {
      const g = G[S.guide];
      return `<button class="chip backbtn" type="button" id="backguides">← All plans</button>
      <div class="guide-hero ${styleCls[g.style] || 'g-day'}"><div class="label" style="color:inherit;opacity:.85">${g.when === 'night' ? 'Night' : 'Day'} in Easton${g.example ? ' · Example plan' : ''}</div>
        <h2>${esc(g.title)}</h2><p>${esc(g.intro)}</p>
        <div class="facts"><span>${esc(g.who)}</span><span>${esc(g.time)}</span><span>${esc(g.cost)}</span><span>${g.stops.length} stops</span></div></div>
      <ol class="timeline">${g.stops.map((s, i) => { const p = P[s.place]; return `<li>
        <div class="time">${fmt(s.at)}</div><div class="n">${i + 1}</div>
        <div style="min-width:0"><button class="stop" type="button" data-place="${esc(p.id)}">${esc(p.name)}</button><p>${esc(s.note)}</p></div></li>`; }).join('')}</ol>
      <button class="btn" type="button" data-route="${esc(g.id)}">Show the route</button>`;
    }
    const day = guides.filter(g => g.when !== 'night'), night = guides.filter(g => g.when === 'night');
    return `<h2 class="title">Day or night, Easton's yours</h2><p class="subtitle">Plans you can walk, from the first coffee to the last light on the river. Each one maps its own route.</p>
      ${day.length ? `<h3 class="sec">While the sun's up</h3><div class="gridguides">${day.map(guideCard).join('')}</div>` : ''}
      ${night.length ? `<h3 class="sec">After dark</h3><div class="gridguides">${night.map(guideCard).join('')}</div>` : ''}`;
  }

  /* ---------- map ---------- */
  let map = null, layer = null;
  function ensureMap() {
    if (map || !window.L) return;
    map = L.map('map', { zoomControl: false, maxBounds: [[40.66, -75.26], [40.72, -75.17]], minZoom: 13 }).setView(CENTRE, 16);
    L.control.zoom({ position: 'topright' }).addTo(map);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);
    layer = L.layerGroup().addTo(map);
    map.on('click', e => {
      if (!S.pick) return;
      const ll = `${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}`;
      const card = $('#mapcard');
      card.innerHTML = `<h4>Pin location</h4><p>Copy these into the listing's <code>lat</code> and <code>lng</code>.</p><div class="coords">${ll}</div>`;
      card.hidden = false;
    });
  }
  function renderMap(fit) {
    ensureMap();
    const route = S.route && G[S.route];
    const filters = [['all', 'All'], ['landmark', 'Landmarks'], ['food', 'Food'], ['shop', 'Shops'], ['creative', 'Creative'], ['outdoors', 'Outdoors']];
    $('#mapbar').innerHTML = route
      ? `<div class="routebar"><span><b>${esc(route.title)}</b> · ${route.stops.length} stops</span><button type="button" id="clearroute">Clear route</button></div>`
      : `<div class="chips">${filters.map(([k, l]) => `<button class="chip" type="button" data-mapcat="${k}" aria-pressed="${S.mapCat === k}">${l}</button>`).join('')}</div>`;
    const card = $('#mapcard');
    const sel = S.sel && P[S.sel];
    if (sel) {
      card.innerHTML = `<h4>${esc(sel.name)}${exTag(sel)}</h4><p>${esc(sel.sub)}${sel.addr ? ' · ' + esc(sel.addr.replace(/, Easton, PA$/, '')) : ''} ${pill(sel)}</p>
        <div class="btns" style="margin-top:0"><button class="btn" type="button" data-place="${esc(sel.id)}">Details</button>
        <a class="btn ghost" href="${dirLink(sel.addr)}" target="_blank" rel="noopener">Directions</a>
        <button class="btn ghost" type="button" id="closecard">Close</button></div>`;
      card.hidden = false;
    } else if (!S.pick) card.hidden = true;
    if (!map) return;
    layer.clearLayers();
    if (route) {
      const pts = route.stops.map(s => P[s.place]).filter(p => p && p.lat != null);
      L.polyline(pts.map(p => [p.lat, p.lng]), { color: cssVar('--ink'), weight: 3, dashArray: '6 6' }).addTo(layer);
      pts.forEach((p, i) => L.marker([p.lat, p.lng], {
        icon: L.divIcon({ className: '', html: `<div class="pin-num" style="width:26px;height:26px">${i + 1}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] }),
        title: p.name
      }).on('click', () => { S.sel = p.id; renderMap(); }).addTo(layer));
      if (fit && pts.length) map.fitBounds(pts.map(p => [p.lat, p.lng]), { padding: [40, 40], maxZoom: 17 });
    } else {
      places.filter(p => p.lat != null && (S.mapCat === 'all' || p.type === S.mapCat)).forEach(p => {
        L.circleMarker([p.lat, p.lng], {
          radius: S.sel === p.id ? 11 : 8, color: cssVar(S.sel === p.id ? '--ink' : '--surface'), weight: 2.5,
          fillColor: cssVar(TYPES[p.type].color), fillOpacity: 1
        }).bindTooltip(p.name).on('click', () => { S.sel = p.id; renderMap(); }).addTo(layer);
      });
      if (fit && sel && sel.lat != null) map.setView([sel.lat, sel.lng], Math.max(map.getZoom(), 17));
    }
  }

  /* ---------- sheets ---------- */
  function sheet(html) {
    $('#sheetroot').innerHTML = `<div class="scrim" id="scrim"><div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div></div>`;
    const f = $('#sheetroot .sheet button, #sheetroot .sheet a'); f && f.focus({ preventScroll: true });
  }
  const closeSheet = () => { $('#sheetroot').innerHTML = ''; };
  function evSheet(key) {
    const o = occurrences.find(x => x.key === key); if (!o) return;
    const p = P[o.place], on = saved.has(key);
    sheet(`${o.example ? '<span class="example">Example event</span>' : ''}<h2>${esc(o.title)}</h2>
      <dl class="meta"><dt>When</dt><dd>${dayLabel(o.ymd)} · ${fmt(o.start)}${o.end ? '–' + fmt(o.end) : ''}</dd>
      ${p ? `<dt>Where</dt><dd>${esc(p.name)}${p.addr ? ', ' + esc(p.addr.replace(/, Easton, PA$/, '')) : ''}</dd>` : ''}
      <dt>Cost</dt><dd>${o.free ? 'Free' : esc(o.price || 'See details')}</dd>
      ${o.url ? `<dt>More</dt><dd><a href="${esc(o.url)}" target="_blank" rel="noopener">${esc(o.url.replace(/^https?:\/\//, ''))}</a></dd>` : ''}</dl>
      <p>${esc(o.desc)}</p>
      <div class="btns"><button class="btn" type="button" data-save="${esc(key)}">${on ? 'Remove from my plan' : 'Add to my plan'}</button>
      ${p && p.lat != null ? `<button class="btn ghost" type="button" data-showmap="${esc(p.id)}">Show on map</button>` : ''}</div>`);
  }
  function placeSheet(id) {
    const p = P[id]; if (!p) return;
    const evs = occurrences.filter(o => o.place === id).slice(0, 4);
    sheet(`${p.example ? '<span class="example">Example listing</span>' : ''}
      <h2>${esc(p.name)}</h2><div class="row-sub" style="white-space:normal">${esc(p.sub)}${p.price ? ' · ' + p.price : ''} ${pill(p)}</div>
      ${p.photo ? `<img src="${esc(p.photo)}" alt="" style="border-radius:12px;margin-top:10px">` : ''}
      <p>${esc(p.blurb)}</p>
      <dl class="meta">${p.addr ? `<dt>Address</dt><dd>${esc(p.addr)}</dd>` : ''}
        ${p.hours ? `<dt>Hours</dt><dd>${hoursText(p)}</dd>` : ''}
        ${p.tags ? `<dt>Offers</dt><dd>${esc(p.tags.join(', '))}</dd>` : ''}
        ${p.rate ? `<dt>Rates</dt><dd>${esc(p.rate)}</dd>` : ''}
        ${p.phone ? `<dt>Phone</dt><dd>${esc(p.phone)}</dd>` : ''}
        ${p.url ? `<dt>Web</dt><dd><a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))}</a></dd>` : ''}</dl>
      ${evs.length ? `<div class="day">Coming up here</div><div class="list">${evs.map(evRow).join('')}</div>` : ''}
      <div class="btns">${p.lat != null ? `<button class="btn" type="button" data-showmap="${esc(p.id)}">Show on map</button>` : ''}
        ${p.addr ? `<a class="btn ghost" href="${dirLink(p.addr)}" target="_blank" rel="noopener">Google Maps</a><a class="btn ghost" href="${dirLink(p.addr, 'apple')}" target="_blank" rel="noopener">Apple Maps</a>` : ''}</div>`);
  }
  function artistSheet(id) {
    const a = artists.find(x => x.id === id); if (!a) return;
    sheet(`${a.example ? '<span class="example">Example artist</span>' : ''}
      <div style="display:grid;grid-template-columns:110px minmax(0,1fr);gap:14px;align-items:center;margin-top:8px">${artistArt(a)}
      <div><h2 style="margin:0">${esc(a.name)}</h2><div class="row-sub" style="white-space:normal">${esc(a.medium)}</div></div></div>
      <p>${esc(a.bio)}</p><dl class="meta">${a.see ? `<dt>See the work</dt><dd>${esc(a.see)}</dd>` : ''}
      ${a.url ? `<dt>Web</dt><dd><a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.url.replace(/^https?:\/\/(www\.)?/, ''))}</a></dd>` : ''}</dl>`);
  }
  function planSheet() {
    const mine = occurrences.filter(o => saved.has(o.key));
    sheet(`<h2>My plan</h2>${mine.length ? mine.map(o => `<div class="day">${dayLabel(o.ymd)}</div><div class="list">${evRow(o)}</div>`).join('')
      : '<p class="empty">Nothing saved yet. Tap any event, then “Add to my plan,” and it’ll wait for you here. Your plan stays on this phone.</p>'}`);
  }

  /* ---------- render & routing ---------- */
  function renderTabs() {
    $('#tabs').innerHTML = Object.keys(TABS).map(k => `<button class="tab" type="button" data-tab="${k}" ${S.tab === k ? 'aria-current="page"' : ''}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">${ICONS[k]}</svg>${TABS[k]}</button>`).join('');
    $('#plancount').textContent = occurrences.filter(o => saved.has(o.key)).length;
  }
  function render(keepScroll, fitMap) {
    const scr = $('#screen'), isMap = S.tab === 'map';
    scr.hidden = isMap; $('#mapview').hidden = !isMap;
    if (isMap) { renderMap(fitMap); if (map) setTimeout(() => map.invalidateSize(), 0); }
    else {
      const top = scr.scrollTop;
      scr.innerHTML = { today, events: eventsScreen, directory, guides: guidesScreen }[S.tab]();
      scr.scrollTop = keepScroll ? top : 0;
    }
    renderTabs();
  }
  function go(tab, opts = {}, fitMap) {
    Object.assign(S, opts); S.tab = tab; closeSheet(); render(false, fitMap);
    const h = tab === 'directory' && S.seg !== 'businesses' ? 'directory-' + S.seg : tab;
    if (location.hash.slice(1) !== h && !(S.pick && tab === 'map')) history.replaceState(null, '', '#' + h);
  }
  function fromHash() {
    const h = location.hash.slice(1);
    if (h === 'pick') return go('map', { pick: true, route: null, sel: null });
    if (h === 'directory-creatives') return go('directory', { seg: 'creatives', q: '' });
    if (h === 'directory-artists') return go('directory', { seg: 'artists', q: '' });
    if (h === 'directory') return go('directory', { seg: 'businesses' });
    if (h === 'guides') return go('guides', { guide: null });
    if (TABS[h]) return go(h);
  }

  /* ---------- interactions ---------- */
  document.addEventListener('click', e => {
    const t = e.target.closest('button, a, #scrim');
    if (!t) return;
    if (t.id === 'scrim') { if (e.target.id === 'scrim') closeSheet(); return; }
    const href = t.tagName === 'A' ? t.getAttribute('href') : null;
    if (href && href.startsWith('#')) { e.preventDefault(); location.hash === href ? fromHash() : (location.hash = href); return; }
    if (t.tagName === 'A') return;
    const d = t.dataset;
    if (d.tab) { if (d.tab === 'guides') S.guide = null; if (d.tab === 'map') S.sel = null; go(d.tab); return; }
    if (d.ev) return evSheet(d.ev);
    if (d.place) return placeSheet(d.place);
    if (d.artist) return artistSheet(d.artist);
    if (d.guide) return go('guides', { guide: d.guide });
    if (d.route) return go('map', { route: d.route, sel: null, pick: false }, true);
    if (d.showmap) return go('map', { route: null, sel: d.showmap, mapCat: 'all', pick: false }, true);
    if (d.save) { saved.has(d.save) ? saved.delete(d.save) : saved.add(d.save); persist(); evSheet(d.save); if (S.tab !== 'map') render(true); else renderTabs(); return; }
    if (d.evcat) { S.evCat = d.evcat; return render(true); }
    if (d.seg) { S.seg = d.seg; S.q = ''; S.dirCat = 'all'; return go('directory'); }
    if (d.dircat) { S.dirCat = d.dircat; return render(true); }
    if (d.mapcat) { S.mapCat = d.mapcat; S.sel = null; return renderMap(); }
    if (t.id === 'clearroute') { S.route = null; return renderMap(); }
    if (t.id === 'closecard') { S.sel = null; return renderMap(); }
    if (t.id === 'backguides') { S.guide = null; return render(); }
    if (t.id === 'planbtn') return planSheet();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });
  document.addEventListener('input', e => {
    if (e.target.id !== 'dirsearch') return;
    S.q = e.target.value; const pos = e.target.selectionStart; render(true);
    const i = $('#dirsearch'); i.focus(); i.setSelectionRange(pos, pos);
  });
  window.addEventListener('hashchange', fromHash);

  /* ---------- load ---------- */
  const getJSON = f => fetch('/data/' + f, { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error(f); return r.json(); });
  Promise.all(['settings.json', 'places.json', 'events.json', 'artists.json', 'guides.json'].map(getJSON)).then(([settings, pl, ev, ar, gu]) => {
    const keep = x => settings.showExamples || !x.example;
    places = pl.filter(keep); P = Object.fromEntries(places.map(p => [p.id, p]));
    events = ev.filter(keep).filter(e => !e.place || P[e.place]);
    artists = ar.filter(keep);
    guides = gu.filter(keep).filter(g => g.stops.every(s => P[s.place])); G = Object.fromEntries(guides.map(g => [g.id, g]));
    occurrences = expandEvents(14);
    if (location.hash) fromHash(); else render();
  }).catch(() => {
    $('#screen').innerHTML = '<p class="empty">We couldn\'t load Easton just now. Check your connection and try again.</p>';
  });

  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
})();
