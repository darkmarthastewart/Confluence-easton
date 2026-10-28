// Confluence Easton app. Reads everything from /data/*.json; no build step.
(function () {
  'use strict';

  const TZ = 'America/New_York';
  const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const CENTRE = [40.6912, -75.2091];
  // each kind of place glows its own color on plaques and map pins
  const TYPES = {
    landmark: { label: 'Landmarks', glow: 'yellow', pin: '#FFE7A0' },
    food: { label: 'Food & drink', glow: 'pink', pin: '#FF5C9A' },
    shop: { label: 'Shops', glow: 'yellow', pin: '#FFC93C' },
    creative: { label: 'Creative', glow: 'teal', pin: '#3FE0CF' },
    outdoors: { label: 'Outdoors', glow: 'teal', pin: '#7FF5E6' }
  };
  const TABS = { today: 'Today', events: 'Events', map: 'Map', directory: 'Town', guides: 'Day/Night' };

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
    for (const [, c] of yest) if (c > 1440 && NOW.min < c - 1440) return { open: true, txt: 'Open till ' + fmt(c - 1440) };
    for (const [o, c] of today) if (NOW.min >= o && NOW.min < c) return { open: true, txt: 'Open till ' + fmt(c) };
    const next = today.find(([o]) => o > NOW.min);
    if (next) return { open: false, txt: 'Opens ' + fmt(next[0]) };
    return { open: false, txt: today.length ? 'Closed for the day' : 'Closed today' };
  }
  function hoursText(p) {
    if (!p.hours) return '';
    const order = [1, 2, 3, 4, 5, 6, 0], lines = [];
    const label = d => { const r = rangesFor(p, d); return r.length ? r.map(([o, c]) => `${fmt(o)}–${fmt(c)}`).join(', ') : 'Closed'; };
    let start = order[0], prev = label(start);
    for (let i = 1; i <= order.length; i++) {
      const cur = i < order.length ? label(order[i]) : null;
      if (cur !== prev) {
        const end = order[i - 1];
        lines.push(`${DAY_NAMES[start]}${end !== start ? '–' + DAY_NAMES[end] : ''}: ${prev}`);
        start = order[i]; prev = cur;
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
  const initials = n => n.replace(/&/g, '').split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase();
  const exTag = x => x.example ? ' <span class="example">Example</span>' : '';
  const dirLink = (addr, kind) => kind === 'apple'
    ? 'https://maps.apple.com/?daddr=' + encodeURIComponent(addr)
    : 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(addr);
  const shortAddr = a => (a || '').replace(/, Easton, PA$/, '');

  // Old neon: in a lit word, one tube may be burned out and another may flicker.
  // Seeded from the text, so a word always wears the same way.
  function wear(text, seed = 0) {
    const chars = [...String(text)];
    const letters = chars.map((c, i) => /[A-Za-z]/.test(c) && i > 0 ? i : -1).filter(i => i >= 0);
    if (letters.length < 3) return esc(text);
    let h = seed + 7;
    for (const c of chars) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const dead = h % 3 !== 0 ? letters[h % letters.length] : -1;
    let fl = letters[(h >>> 7) % letters.length];
    if (fl === dead || (h >>> 4) % 2) fl = -1;
    return chars.map((c, i) => i === dead ? `<span class="dead">${esc(c)}</span>` : i === fl ? `<span class="flicker2">${esc(c)}</span>` : esc(c)).join('');
  }
  const neon = (text, color = 'pink', seed) => `<span class="glow-${color}">${wear(text, seed)}</span>`;
  const pinColor = p => TYPES[p.type].pin;

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
  const artistArt = a => a.photo ? `<img class="art" src="${esc(a.photo)}" alt="" style="object-fit:cover">` : artSVG(a.colors || ['#1D6683', '#E5A91A', '#13232B'], a.name.length * 97);

  /* ---------- the big sign ---------- */
  /* ---------- the sign at the top of Today ---------- */
  // A real photo of an Easton sign goes here (settings.json "heroPhoto"); until then, just the neon script.
  let heroPhoto = null;
  function heroSign() {
    const script = `<div class="hero-script glow-pink" aria-hidden="true">Confluence</div>`;
    if (heroPhoto) return `<figure class="hero has-photo" style="margin-bottom:0"><div class="photo"><img src="${esc(heroPhoto.src)}" alt="${esc(heroPhoto.alt || 'A sign in downtown Easton')}">
      ${heroPhoto.credit ? `<figcaption>${esc(heroPhoto.credit)}</figcaption>` : ''}</div>${script}</figure>`;
    return `<div class="hero">${script}<div class="hero-place caps">Easton · Pennsylvania</div></div>`;
  }

  /* ---------- rows & cards ---------- */
  function evRow(o) {
    const p = P[o.place];
    const end = saved.has(o.key) ? '<span class="tag glow-pink">Saved</span>'
      : o.free ? '<span class="tag glow-teal">FREE</span>' : `<span class="tag">${esc(o.price || '')}</span>`;
    return `<button class="row" type="button" data-ev="${esc(o.key)}">
      <div class="time glow-red">${fmt(o.start).replace(' ', '&nbsp;')}${o.end ? `<small>till ${fmt(o.end)}</small>` : ''}</div>
      <div style="min-width:0"><div class="row-title">${esc(o.title)}</div><div class="row-sub">${esc(p ? p.name : '')}</div></div>
      <div class="row-end">${end}${o.example ? '<span class="example">Example</span>' : ''}</div>
    </button>`;
  }
  function marketCard(o) {
    return `<button class="feature enamel" type="button" data-ev="${esc(o.key)}">
      <div class="time glow-yellow">${fmt(o.start).replace(' ', '&nbsp;')}</div>
      <div style="min-width:0"><div class="name glow-yellow">${wear(o.title)}</div><div class="row-sub" style="white-space:normal">${esc(P[o.place] ? P[o.place].name : '')} · till ${fmt(o.end)}</div></div>
    </button>`;
  }
  function plaque(p, lit) {
    if (p.photo) return `<div class="plaque"><img src="${esc(p.photo)}" alt=""></div>`;
    return `<div class="plaque ${lit ? 'glow-' + TYPES[p.type].glow : 'dead'}">${esc(initials(p.name))}</div>`;
  }
  function placeRow(p) {
    const o = openState(p);
    const sub = p.type === 'creative' && p.tags ? p.tags.join(' · ') : p.sub + (p.price ? ' · ' + p.price : '');
    const lit = !o || o.open;
    const sign = o ? (o.open ? '<span class="open-sign">OPEN</span>' : '<span class="closed-sign">CLOSED</span>') : '';
    return `<button class="row place" type="button" data-place="${esc(p.id)}">${plaque(p, lit)}
      <div style="min-width:0"><div class="row-title"${lit ? '' : ' style="color:var(--soft)"'}>${esc(p.name)}</div><div class="row-sub">${esc(sub)}${o && !o.open ? ' · ' + esc(o.txt) : ''}</div></div>
      <div class="row-end">${sign}${p.example ? '<span class="example">Example</span>' : ''}</div></button>`;
  }
  function guideCard(g) {
    const k = `<span class="k">${esc(g.who)} · ${g.stops.length} stops</span>`;
    const m = `<span class="m">${esc(g.time)}</span>`;
    let cls = 'enamel', t;
    if (g.style === 'day') { cls = 'tin'; t = `<span class="t script">${esc(g.title)}</span>`; }
    else if (g.style === 'warm') { cls = 'shoppe'; t = `<span class="t capsy">${esc(g.title)}</span>`; }
    else if (g.style === 'art') t = `<span class="t script glow-yellow">${wear(g.title)}</span>`;
    else t = `<span class="t script glow-pink">${wear(g.title)}</span>`;
    return `<button class="gcard ${cls}" type="button" data-guide="${esc(g.id)}">${k}${t}${m}</button>`;
  }
  const artistCard = (a, feature) => `<button class="artist" type="button" data-artist="${esc(a.id)}">
      <div class="frame">${artistArt(a)}</div>
      <div style="min-width:0"><div class="who glow-pink">${wear(a.name)}</div><div class="med">${esc(a.medium)}</div>
      ${feature ? `<p>${esc(a.bio)}</p>` : ''}${a.example ? '<span class="example" style="margin-top:6px">Example</span>' : ''}</div></button>`;

  /* ---------- screens ---------- */
  function today() {
    const h = Math.floor(NOW.min / 60);
    const hello = h < 5 ? 'Still up, Easton?' : h < 12 ? 'Morning, Easton.' : h < 17 ? 'Afternoon, Easton.' : h < 22 ? 'Evening, Easton.' : 'Still up, Easton?';
    const todays = occurrences.filter(o => o.ymd === NOW.ymd);
    const upcoming = todays.length ? todays : occurrences.slice(0, 4);
    const mine = occurrences.filter(o => saved.has(o.key));
    const openNow = places.filter(p => (p.type === 'food' || p.type === 'shop') && openState(p)?.open).slice(0, 4);
    const featured = artists.find(a => a.featured) || artists[0];
    return `${heroSign()}
    <div class="notice">We're just getting started, so you'll see a few <span class="example">Example</span> listings while the real ones come in. Run a business, make things or put on events? <a href="/join/">Get on the map, free</a>.</div>
    <h2 class="title glow-pink">${wear(hello)}</h2><p class="subtitle">${esc(dayLabel(NOW.ymd).replace('Today · ', ''))} · Here's what's on downtown</p>
    ${mine.length ? `<div class="sec">Your plan</div><div class="list">${mine.map(evRow).join('')}</div>` : ''}
    <div class="enamel board" style="margin-top:20px">
      <div class="board-head glow-yellow">${wear(todays.length ? 'ON TODAY' : 'COMING UP', 3)}</div>
      ${upcoming.length ? upcoming.map(evRow).join('') : '<p class="empty">Quiet week on the calendar so far. Wander anyway; downtown has a way of surprising you.</p>'}
    </div>
    <p style="text-align:right;margin:8px 0 0"><a href="#events" class="tag" style="text-decoration:none">See everything →</a></p>
    ${guides.length ? `<div class="sec">Make a day of it <a href="#guides">See all</a></div><div class="hcards">${guides.map(guideCard).join('')}</div>` : ''}
    ${featured ? `<div class="sec">Someone you should know</div>${artistCard(featured, true)}` : ''}
    ${openNow.length ? `<div class="sec">Open right now <a href="#directory">Around town</a></div><div class="list">${openNow.map(placeRow).join('')}</div>` : ''}`;
  }

  function eventsScreen() {
    const cats = [['all', 'All'], ['music', 'Music'], ['art', 'Art'], ['family', 'Family'], ['food', 'Food'], ['free', 'Free']];
    const list = occurrences.filter(o => S.evCat === 'all' || (S.evCat === 'free' ? o.free : (o.cats || []).includes(S.evCat)));
    const days = [...new Set(list.map(o => o.ymd))];
    return `<h2 class="title glow-pink">${wear("What's on")}</h2><p class="subtitle">The next two weeks, from the Circle down to the river</p>
    <div class="chips" role="group" aria-label="Filter events" style="margin-top:14px">${cats.map(([k, l]) => `<button class="chip" type="button" data-evcat="${k}" aria-pressed="${S.evCat === k}">${l}</button>`).join('')}</div>
    ${days.length ? days.map(d => `<div class="day"><span class="rusttag">${esc(dayLabel(d).toUpperCase())}</span></div>
      <div class="list">${list.filter(o => o.ymd === d).map(o => o.repeat ? marketCard(o) : evRow(o)).join('')}</div>`).join('')
      : '<p class="empty">Nothing like that on the calendar yet. Try another, or check back soon.</p>'}
    <p class="empty">Putting something on? <a href="/join/#event">Add your event, free</a>.</p>`;
  }

  function directory() {
    const segs = [['businesses', 'Businesses'], ['creatives', 'Creatives'], ['artists', 'Artists']];
    const q = S.q.trim().toLowerCase();
    const match = (...f) => !q || f.join(' ').toLowerCase().includes(q);
    const ph = { businesses: 'Search shops, food, coffee', creatives: 'Search services, like logo or portraits', artists: 'Search artists or mediums' }[S.seg];
    const none = '<p class="empty">Nobody by that name yet. Try another word.</p>';
    let body = '';
    if (S.seg === 'businesses') {
      const cats = [['all', 'All'], ['food', 'Food & drink'], ['shop', 'Shops'], ['landmark', 'Landmarks'], ['open', 'Open now']];
      const list = places.filter(p => ['food', 'shop', 'landmark', 'outdoors'].includes(p.type) &&
        (S.dirCat === 'all' || (S.dirCat === 'open' ? openState(p)?.open : S.dirCat === 'landmark' ? (p.type === 'landmark' || p.type === 'outdoors') : p.type === S.dirCat)) &&
        match(p.name, p.sub, p.blurb));
      body = `<div class="chips">${cats.map(([k, l]) => `<button class="chip" type="button" data-dircat="${k}" aria-pressed="${S.dirCat === k}">${l}</button>`).join('')}</div>
        <div class="list">${list.length ? list.map(placeRow).join('') : none}</div>`;
    } else if (S.seg === 'creatives') {
      const list = places.filter(p => p.type === 'creative' && match(p.name, p.sub, p.blurb, (p.tags || []).join(' ')));
      body = `<p class="lede" style="margin:0 0 6px">The photographers, designers, printers and players who make Easton look and sound like Easton. Hire local.</p>
        <div class="list">${list.length ? list.map(placeRow).join('') : none}</div>`;
    } else {
      const list = artists.filter(a => match(a.name, a.medium, a.bio));
      body = `<div class="stack" style="margin-top:8px">${list.length ? list.map(a => artistCard(a, false)).join('') : none}</div>`;
    }
    return `<h2 class="title glow-pink">${wear('Around town')}</h2>
      <div class="seg" role="group" aria-label="Directory section">${segs.map(([k, l]) => `<button class="enamel" type="button" data-seg="${k}" aria-pressed="${S.seg === k}">${l.toUpperCase()}</button>`).join('')}</div>
      <input class="search" id="dirsearch" type="search" placeholder="${ph}" value="${esc(S.q)}" aria-label="${ph}">
      ${body}
      <p class="empty">Someone missing? <a href="/join/">Add a listing, free</a>, or send them the link.</p>`;
  }

  function guidesScreen() {
    if (S.guide && G[S.guide]) {
      const g = G[S.guide], last = g.stops.length - 1;
      return `<button class="backlink" type="button" id="backguides">← ALL PLANS</button>
      <div class="guide-head" style="margin-top:10px">
        <div class="label glow-yellow">${wear(((g.when === 'night' ? 'Night' : 'Day') + ' in Easton').toUpperCase(), 2)}</div>
        <h2 class="glow-pink">${wear(g.title)}</h2>
        <p class="lede" style="color:var(--ink);font-size:18px">${esc(g.intro)}</p>
        <div class="facts"><span>${esc(g.who)}</span><span>${esc(g.time)}</span><span>${esc(g.cost)}</span>${g.example ? '<span>Example plan</span>' : ''}</div>
      </div>
      <ol class="timeline">${g.stops.map((s, i) => { const p = P[s.place]; return `<li${i === last - 1 ? ' class="dead-tube"' : ''}>
        <span class="ring${i === last ? ' dead' : ''}">${i + 1}</span><span class="time glow-pink" style="padding-top:5px">${(() => { const v = toMin(s.at); return `${Math.floor(v / 60) % 12 || 12}:${String(v % 60).padStart(2, '0')}`; })()}</span>
        <div style="min-width:0"><button class="stop" type="button" data-place="${esc(p.id)}">${esc(p.name)}</button><p>${esc(s.note)}</p></div></li>`; }).join('')}</ol>
      <button class="tube-btn" style="width:100%" type="button" data-route="${esc(g.id)}">Show the route</button>`;
    }
    const day = guides.filter(g => g.when !== 'night'), night = guides.filter(g => g.when === 'night');
    return `<h2 class="title glow-pink">${wear("Day or night, Easton's yours")}</h2><p class="lede">Plans you can walk, from the first coffee to the last light on the river. Each one maps its own route.</p>
      ${day.length ? `<div class="sec">While the sun's up</div><div class="gridguides">${day.map(guideCard).join('')}</div>` : ''}
      ${night.length ? `<div class="sec">After dark</div><div class="gridguides">${night.map(guideCard).join('')}</div>` : ''}`;
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
      const card = $('#mapcard');
      card.innerHTML = `<h4 class="glow-yellow">Pin location</h4><p>Copy these into the listing's lat and lng.</p><div class="coords">${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}</div>`;
      card.hidden = false;
    });
  }
  function renderMap(fit) {
    ensureMap();
    const route = S.route && G[S.route];
    const filters = [['all', 'All'], ['landmark', 'Landmarks'], ['food', 'Food'], ['shop', 'Shops'], ['creative', 'Creative'], ['outdoors', 'Outdoors']];
    $('#mapbar').innerHTML = route
      ? `<div class="routebar"><b class="glow-pink">${wear(route.title)}</b><button class="tube-btn off" style="min-height:38px;padding:0 14px;font-size:11px" type="button" id="clearroute">Clear route</button></div>`
      : `<div class="chips">${filters.map(([k, l]) => `<button class="chip" type="button" data-mapcat="${k}" aria-pressed="${S.mapCat === k}">${l}</button>`).join('')}</div>`;
    const card = $('#mapcard'), sel = S.sel && P[S.sel];
    if (sel) {
      const o = openState(sel);
      card.innerHTML = `<h4 class="glow-pink">${wear(sel.name)}</h4><p>${esc(sel.sub)}${sel.addr ? ' · ' + esc(shortAddr(sel.addr)) : ''}${o ? ' · ' + esc(o.txt) : ''}${exTag(sel)}</p>
        <div class="btns" style="margin-top:0"><button class="tube-btn" type="button" data-place="${esc(sel.id)}">Details</button>
        <a class="tube-btn off" href="${dirLink(sel.addr)}" target="_blank" rel="noopener">Directions</a>
        <button class="tube-btn off" type="button" id="closecard">Close</button></div>`;
      card.hidden = false;
    } else if (!S.pick) card.hidden = true;
    if (!map) return;
    layer.clearLayers();
    if (route) {
      const pts = route.stops.map(s => P[s.place]).filter(p => p && p.lat != null);
      const ll = pts.map(p => [p.lat, p.lng]);
      L.polyline(ll, { color: '#FF4F8F', weight: 9, opacity: .3 }).addTo(layer);
      L.polyline(ll, { color: '#FFD6E4', weight: 3, className: 'neon-route' }).addTo(layer);
      pts.forEach((p, i) => L.marker([p.lat, p.lng], {
        icon: L.divIcon({ className: '', html: `<div class="pin-num">${i + 1}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] }), title: p.name
      }).on('click', () => { S.sel = p.id; renderMap(); }).addTo(layer));
      if (fit && pts.length) map.fitBounds(ll, { padding: [50, 50], maxZoom: 17 });
    } else {
      places.filter(p => p.lat != null && (S.mapCat === 'all' || p.type === S.mapCat)).forEach(p => {
        const on = S.sel === p.id, size = on ? 28 : 20;
        L.marker([p.lat, p.lng], {
          icon: L.divIcon({ className: '', html: `<div class="pin${on ? ' sel' : ''}" style="color:${pinColor(p)}"></div>`, iconSize: [size, size], iconAnchor: [size / 2, size / 2] }),
          title: p.name, keyboard: true
        }).bindTooltip(p.name).on('click', () => { S.sel = p.id; renderMap(); }).addTo(layer);
      });
      if (fit && sel && sel.lat != null) map.setView([sel.lat, sel.lng], Math.max(map.getZoom(), 17));
    }
  }

  /* ---------- sheets ---------- */
  function sheet(html) {
    $('#sheetroot').innerHTML = `<div class="scrim" id="scrim"><div class="sheet enamel" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div></div>`;
    const f = $('#sheetroot .sheet button, #sheetroot .sheet a'); f && f.focus({ preventScroll: true });
  }
  const closeSheet = () => { $('#sheetroot').innerHTML = ''; };
  const rivets = '<span class="rivet" style="left:12px;top:12px"></span><span class="rivet" style="right:12px;top:12px"></span><span class="rivet" style="left:12px;bottom:12px"></span><span class="rivet" style="right:12px;bottom:12px"></span>';
  function evSheet(key) {
    const o = occurrences.find(x => x.key === key); if (!o) return;
    const p = P[o.place], on = saved.has(key);
    sheet(`<div class="signboard">${rivets}<div class="name glow-pink">${wear(o.title)}</div>
      <div class="kind glow-yellow">${esc(dayLabel(o.ymd).replace('Today · ', 'Today, ').replace('Tomorrow · ', 'Tomorrow, '))}</div></div>
      ${o.example ? '<span class="example">Example event</span>' : ''}
      <dl class="meta"><dt>When</dt><dd>${fmt(o.start)}${o.end ? '–' + fmt(o.end) : ''}</dd>
      ${p ? `<dt>Where</dt><dd>${esc(p.name)}${p.addr ? ', ' + esc(shortAddr(p.addr)) : ''}</dd>` : ''}
      <dt>Cost</dt><dd>${o.free ? 'Free' : esc(o.price || 'See details')}</dd>
      ${o.url ? `<dt>More</dt><dd><a href="${esc(o.url)}" target="_blank" rel="noopener">${esc(o.url.replace(/^https?:\/\//, ''))}</a></dd>` : ''}</dl>
      <p class="blurb">${esc(o.desc)}</p>
      <div class="btns"><button class="tube-btn" type="button" data-save="${esc(key)}">${on ? 'Take off my plan' : 'Add to my plan'}</button>
      ${p && p.lat != null ? `<button class="tube-btn off" type="button" data-showmap="${esc(p.id)}">On the map</button>` : ''}</div>`);
  }
  function placeSheet(id) {
    const p = P[id]; if (!p) return;
    const o = openState(p), evs = occurrences.filter(x => x.place === id).slice(0, 4);
    sheet(`<div class="signboard">${rivets}<div class="name glow-pink">${wear(p.name)}</div>
        <div class="kind glow-yellow">${wear(p.sub.toUpperCase(), 5)}</div></div>
      ${p.photo ? `<img src="${esc(p.photo)}" alt="" style="width:100%;border:3px solid var(--rust-dark);margin-bottom:12px">` : ''}
      ${o ? `<div class="statusline">${o.open ? '<span class="open-sign">OPEN</span>' : '<span class="closed-sign">CLOSED</span>'}<span class="tag">${esc(o.txt.toUpperCase())}${p.price ? ' · ' + p.price : ''}</span></div>` : ''}
      ${p.example ? '<p style="margin:12px 0 0"><span class="example">Example listing</span></p>' : ''}
      <p class="blurb">${esc(p.blurb)}</p>
      <dl class="meta">${p.addr ? `<dt>Address</dt><dd>${esc(shortAddr(p.addr))}</dd>` : ''}
        ${p.hours ? `<dt>Hours</dt><dd>${hoursText(p)}</dd>` : ''}
        ${p.tags ? `<dt>Offers</dt><dd>${esc(p.tags.join(', '))}</dd>` : ''}
        ${p.rate ? `<dt>Rates</dt><dd>${esc(p.rate)}</dd>` : ''}
        ${p.phone ? `<dt>Phone</dt><dd>${esc(p.phone)}</dd>` : ''}
        ${p.url ? `<dt>Web</dt><dd><a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))}</a></dd>` : ''}</dl>
      ${evs.length ? `<div class="sec" style="margin-top:20px">Coming up here</div><div class="list">${evs.map(evRow).join('')}</div>` : ''}
      <div class="btns">${p.addr ? `<a class="tube-btn" href="${dirLink(p.addr)}" target="_blank" rel="noopener">Directions</a>` : ''}
        ${p.lat != null ? `<button class="tube-btn off" type="button" data-showmap="${esc(p.id)}">On the map</button>` : ''}
        ${p.addr ? `<a class="tube-btn off" href="${dirLink(p.addr, 'apple')}" target="_blank" rel="noopener">Apple Maps</a>` : ''}</div>`);
  }
  function artistSheet(id) {
    const a = artists.find(x => x.id === id); if (!a) return;
    sheet(`<div style="text-align:center"><div class="caps glow-yellow" style="font-size:12px">${wear('SOMEONE YOU SHOULD KNOW', 4)}</div>
      <div class="frame" style="margin:18px auto 0;max-width:280px">${artistArt(a)}</div>
      <div class="glow-pink" style="font-family:var(--script);font-size:46px;line-height:1.05;margin-top:20px">${wear(a.name)}</div>
      <div class="caps" style="font-size:12px;color:var(--rust-light);margin-top:8px">${esc(a.medium)}</div>
      ${a.example ? '<p style="margin:10px 0 0"><span class="example">Example artist</span></p>' : ''}</div>
      <p class="blurb" style="text-align:center">${esc(a.bio)}</p>
      <dl class="meta">${a.see ? `<dt>See the work</dt><dd>${esc(a.see)}</dd>` : ''}
      ${a.url ? `<dt>Web</dt><dd><a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.url.replace(/^https?:\/\/(www\.)?/, ''))}</a></dd>` : ''}</dl>`);
  }
  function planSheet() {
    const mine = occurrences.filter(o => saved.has(o.key));
    sheet(`<h2 class="title glow-pink">${wear('My plan')}</h2>${mine.length ? mine.map(o => `<div class="day"><span class="rusttag">${esc(dayLabel(o.ymd).toUpperCase())}</span></div><div class="list">${evRow(o)}</div>`).join('')
      : '<p class="empty">Nothing saved yet. Tap any event, then “Add to my plan,” and it’ll wait for you here. Your plan stays on this phone.</p>'}`);
  }

  /* ---------- welcome ---------- */
  function welcome() {
    const el = document.createElement('section');
    el.className = 'welcome'; el.id = 'welcome'; el.setAttribute('aria-label', 'Welcome to Confluence Easton');
    el.innerHTML = `
      <div class="forks">AT THE FORKS OF THE DELAWARE</div>
      <div class="greet glow-pink">Greetings <span class="dead">f</span><span class="flicker2">r</span>om</div>
      <div class="letters">
        <span class="streak" style="left:13%;top:85%;height:54px"></span><span class="streak" style="left:43%;top:86%;height:34px"></span><span class="streak" style="left:58%;top:85%;height:70px"></span><span class="streak" style="left:85%;top:86%;height:40px"></span>
        <svg viewBox="0 0 390 200" role="img" aria-label="EASTON, each letter a window onto a scene of downtown">
          <defs>
            <linearGradient id="wRiver" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F6A35C"/><stop offset=".45" stop-color="#C85A6A"/><stop offset=".55" stop-color="#2E6C78"/><stop offset="1" stop-color="#173E48"/></linearGradient>
            <pattern id="wBrick" width="20" height="10" patternUnits="userSpaceOnUse"><rect width="20" height="10" fill="#9C3E2A"/><path d="M0 9.5h20M10 0v5M0 5h20" stroke="#5A2216" stroke-width="1"/></pattern>
            <radialGradient id="wSky" cx=".5" cy=".3" r=".8"><stop offset="0" stop-color="#3B4C8A"/><stop offset="1" stop-color="#121A33"/></radialGradient>
            <pattern id="wStars" width="18" height="18" patternUnits="userSpaceOnUse"><rect width="18" height="18" fill="url(#wSky)"/><circle cx="4" cy="5" r=".9" fill="#FFF4CF"/><circle cx="13" cy="12" r=".6" fill="#FFF4CF"/></pattern>
            <linearGradient id="wCandle" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFD25A"/><stop offset=".3" stop-color="#E7E2D8"/><stop offset="1" stop-color="#6E6A62"/></linearGradient>
            <linearGradient id="wSunset" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFB45A"/><stop offset=".6" stop-color="#E0564F"/><stop offset="1" stop-color="#6A2850"/></linearGradient>
            <pattern id="wMarket" width="16" height="16" patternUnits="userSpaceOnUse"><rect width="16" height="16" fill="#3D7A4A"/><rect width="8" height="16" fill="#E9E2D6"/></pattern>
            <filter id="wRough"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="4" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="3" result="d"/><feTurbulence type="fractalNoise" baseFrequency=".35" numOctaves="4" seed="9" result="r"/><feColorMatrix in="r" type="matrix" values="0 0 0 0 .55  0 0 0 0 .2  0 0 0 0 .06  0 0 0 -2.4 1.3" result="spots"/><feComposite in="spots" in2="d" operator="in" result="rs"/><feMerge><feMergeNode in="d"/><feMergeNode in="rs"/></feMerge></filter>
          </defs>
          <g font-family="Bebas Neue, Impact, sans-serif" font-size="150" stroke="#4A200E" stroke-width="5" paint-order="stroke" filter="url(#wRough)">
            <text x="6" y="176" fill="url(#wRiver)">E</text><text x="64" y="176" fill="url(#wBrick)">A</text><text x="131" y="176" fill="url(#wStars)">S</text>
            <text x="192" y="176" fill="url(#wCandle)">T</text><text x="250" y="176" fill="url(#wSunset)">O</text><text x="317" y="176" fill="url(#wMarket)">N</text>
          </g>
        </svg>
      </div>
      <div class="state glow-yellow">PENN<span class="dead">S</span>YLV<span class="flicker">A</span>NIA</div>
      <div class="motto">Where the city comes together.</div>
      <button class="tube-btn" type="button" id="comein">Come on in</button>
      <div class="foot">EVENTS · PLACES · CREATIVES · ARTISTS</div>`;
    document.querySelector('.app').appendChild(el);
    $('#comein').focus({ preventScroll: true });
  }
  function closeWelcome() {
    const el = $('#welcome'); if (el) el.remove();
    try { localStorage.setItem('confluence-welcomed', '1'); } catch (e) {}
    if (location.hash === '#welcome') history.replaceState(null, '', '#today');
  }

  /* ---------- render & routing ---------- */
  function renderTabs() {
    $('#tabs').innerHTML = Object.keys(TABS).map(k => `<button class="tab" type="button" data-tab="${k}" ${S.tab === k ? 'aria-current="page"' : ''}>${TABS[k].toUpperCase()}</button>`).join('');
    const n = occurrences.filter(o => saved.has(o.key)).length;
    $('#plancount').textContent = n;
    $('#planbtn').classList.toggle('lit', n > 0);
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
    if (h === 'welcome') { if (!$('#welcome')) welcome(); return; }
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
    if (t.id === 'comein') return closeWelcome();
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
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { if ($('#welcome')) closeWelcome(); else closeSheet(); } });
  document.addEventListener('input', e => {
    if (e.target.id !== 'dirsearch') return;
    S.q = e.target.value; const pos = e.target.selectionStart; render(true);
    const i = $('#dirsearch'); i.focus(); i.setSelectionRange(pos, pos);
  });
  window.addEventListener('hashchange', fromHash);

  /* ---------- load ---------- */
  let welcomed = false;
  try { welcomed = localStorage.getItem('confluence-welcomed') === '1'; } catch (e) {}
  if (!welcomed && !location.hash) welcome();

  const getJSON = f => fetch('/data/' + f, { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error(f); return r.json(); });
  Promise.all(['settings.json', 'places.json', 'events.json', 'artists.json', 'guides.json'].map(getJSON)).then(([settings, pl, ev, ar, gu]) => {
    heroPhoto = settings.heroPhoto && settings.heroPhoto.src ? settings.heroPhoto : null;
    const keep = x => settings.showExamples || !x.example;
    places = pl.filter(keep); P = Object.fromEntries(places.map(p => [p.id, p]));
    events = ev.filter(keep).filter(e => !e.place || P[e.place]);
    artists = ar.filter(keep);
    guides = gu.filter(keep).filter(g => g.stops.every(s => P[s.place])); G = Object.fromEntries(guides.map(g => [g.id, g]));
    occurrences = expandEvents(14);
    if (location.hash) fromHash(); else render();
    if (location.hash === '#welcome') render();
  }).catch(() => {
    $('#screen').innerHTML = '<p class="empty">We couldn\'t load Easton just now. Check your connection and try again.</p>';
  });

  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
})();
