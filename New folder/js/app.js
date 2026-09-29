(() => {
  'use strict';

  const C = window.BS_CONFIG;
  const MENU = window.BS_MENU;
  const CATS = window.BS_CATS;
  const I18N = window.BS_I18N;
  const AREAS = window.BS_AREAS;

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const byId = Object.fromEntries(MENU.map(i => [i.id, i]));
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const BURGER_CATS = ['signature', 'classic', 'chicken', 'lenten'];
  const TYPE_FILTERS = ['beef', 'chicken', 'lenten'];

  /* ---------- Storage (per-browser conveniences only) ---------- */
  const store = {
    get(k, d) {
      try { const v = localStorage.getItem('bs.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; }
    },
    set(k, v) {
      try { localStorage.setItem('bs.' + k, JSON.stringify(v)); } catch (e) { /* private mode */ }
    }
  };

  const state = {
    lang: store.get('lang', null) || ((navigator.language || '').toLowerCase().startsWith('ka') ? 'ka' : 'en'),
    cur: store.get('cur', 'GEL'),
    cart: store.get('cart', []),
    mode: store.get('mode', 'delivery'),
    area: store.get('area', ''),
    geo: null,
    geoError: false,
    address: store.get('address', ''),
    plate: store.get('plate', ''),
    car: store.get('car', ''),
    dine: Object.assign({ guests: 2, day: 'today', time: '', seat: 'any', name: '' }, store.get('dine', {})),
    split: 1,
    filters: new Set(),
    q: '',
    qRaw: '',
    sort: 'rec',
    sizes: {},
    favs: store.get('favs', []),
    last: store.get('last', null),
    theme: store.get('theme', 'light')
  };
  const cleanCart = list => (Array.isArray(list) ? list : []).filter(l => l && byId[l.id] && l.qty > 0);
  state.cart = cleanCart(state.cart);
  if (!Array.isArray(state.favs)) state.favs = [];
  state.favs = state.favs.filter(id => byId[id]);
  if (!['delivery', 'kerbside', 'dine'].includes(state.mode)) state.mode = 'delivery';
  if (!C.rates[state.cur]) state.cur = 'GEL';

  /* ---------- Text & numbers ---------- */
  function t(key, vars) {
    let s = (I18N[state.lang] && I18N[state.lang][key]) ?? I18N.en[key] ?? key;
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m));
    return s;
  }
  const L = obj => (obj ? (obj[state.lang] ?? obj.en) : '');
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (n, d = 2) => { const s = n.toFixed(d); return state.lang === 'ka' ? s.replace('.', ',') : s; };
  const vol = v => (state.lang === 'ka' ? v.replace('.', ',') : v) + ' ' + t('unit.l');
  const gel = n => num(n) + ' ₾';
  const round2 = n => Math.round(n * 100) / 100;
  function money(n) {
    if (state.cur === 'GEL') return gel(n);
    return (state.cur === 'USD' ? '$' : '€') + num(n * C.rates[state.cur]);
  }
  const imgSrc = it => 'assets/menu/' + it.img + '.jpg';

  /* ---------- Animated buttons: dot grows into a fill, label slides out, label + arrow slide in ---------- */
  const ARROW = '<svg class="ib-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>';
  function btnInner(label, icon = '') {
    return `<span class="ib-dot" aria-hidden="true"></span>` +
      `<span class="ib-idle">${icon}<span class="ib-label">${esc(label)}</span></span>` +
      `<span class="ib-hover" aria-hidden="true"><span class="ib-label">${esc(label)}</span>${ARROW}</span>`;
  }
  function enhanceButton(btn) {
    const keyEl = btn.matches('[data-i18n]') ? btn : btn.querySelector('[data-i18n]');
    if (keyEl) { btn.dataset.label = keyEl.dataset.i18n; if (keyEl === btn) btn.removeAttribute('data-i18n'); }
    const icon = btn.querySelector(':scope > svg');
    btn.innerHTML = btnInner(btn.dataset.label ? t(btn.dataset.label) : btn.textContent.trim(), icon ? icon.outerHTML : '');
  }
  function setBtnLabel(btn, text) { $$('.ib-label', btn).forEach(s => { s.textContent = text; }); }

  /* ---------- Prices & sizes ---------- */
  function currentSize(item) {
    if (state.sizes[item.id] != null) return state.sizes[item.id];
    return item.sizes ? '0' : item.std ? 'big' : '';
  }
  function priceOf(item, size) {
    if (item.sizes) return item.sizes[+size || 0].price;
    if (size === 'std' && item.std) return item.std;
    return item.price;
  }
  const wasOf = (item, size) => (item.was && size !== 'std' ? item.was : null);
  function sizeLabel(item, size) {
    if (item.sizes) return vol(item.sizes[+size || 0].vol);
    if (item.std) return size === 'std' ? 'STD' : 'BIG';
    return '';
  }
  function lineName(item, size) {
    const base = L(item.full || item.name);
    const s = sizeLabel(item, size);
    return s ? `${base} (${s})` : base;
  }

  /* ---------- Tbilisi clock (UTC+4, no daylight saving) ---------- */
  function tbilisiNow() {
    const d = new Date(Date.now() + 4 * 3600 * 1000);
    return { h: d.getUTCHours(), m: d.getUTCMinutes(), s: d.getUTCSeconds() };
  }
  const toMin = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  const pad = n => String(n).padStart(2, '0');
  const hhmm = m => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;

  function openState() {
    const n = tbilisiNow();
    const sec = n.h * 3600 + n.m * 60 + n.s;
    const o = toMin(C.open) * 60, c = toMin(C.close) * 60;
    let open, left;
    if (c > o) {
      open = sec >= o && sec < c;
      left = open ? c - sec : (sec < o ? o - sec : 86400 - sec + o);
    } else {
      open = sec >= o || sec < c;
      left = open ? (sec >= o ? 86400 - sec + c : c - sec) : o - sec;
    }
    return { open, left, now: n };
  }

  function tickStatus() {
    const st = openState();
    const mins = Math.ceil(st.left / 60);
    const h = Math.floor(mins / 60), m = mins % 60;
    const dur = (h ? `${h} ${t('unit.h')} ` : '') + `${m} ${t('unit.min')}`;
    $('#status').classList.toggle('open', st.open);
    $('#statusText').textContent = st.open
      ? `${t('status.open')} · ${t('status.closes', { t: C.close })} · ${t('hero.in', { d: dur })}`
      : `${t('status.closed')} · ${t('status.opens', { t: C.open })} · ${t('hero.in', { d: dur })}`;
  }

  /* ---------- Delivery geometry ---------- */
  const KM_LNG = 111.32 * Math.cos(C.lat * Math.PI / 180), KM_LAT = 110.57;
  const offsetKm = p => ({ x: (p.lng - C.lng) * KM_LNG, y: (p.lat - C.lat) * KM_LAT });
  const distKm = p => { const o = offsetKm(p); return Math.hypot(o.x, o.y); };
  function zoneOf(km) {
    const z = C.zones;
    return km <= z[0] ? 'inner' : km <= z[1] ? 'middle' : km <= z[2] ? 'outer' : 'beyond';
  }
  function etaRange(km) {
    const base = C.eta.base + km * C.eta.perKm;
    const a = Math.floor(base / 5) * 5;
    return { a, b: a + 10 };
  }
  function deliveryInfo() {
    let p = null;
    if (state.geo) p = { lat: state.geo.lat, lng: state.geo.lng, label: t('delivery.me') };
    else if (state.area) { const a = AREAS.find(x => x.id === state.area); if (a) p = { lat: a.lat, lng: a.lng, label: L(a) }; }
    if (!p) return null;
    p.km = distKm(p);
    p.zone = zoneOf(p.km);
    return p;
  }

  function renderAreaSelect() {
    const sel = $('#areaSelect');
    const sorted = AREAS.map(a => ({ a, km: distKm(a) })).sort((x, y) => x.km - y.km);
    sel.innerHTML = `<option value="">${esc(t('delivery.choose'))}</option>` +
      (state.geo ? `<option value="__me">${esc(t('delivery.me'))}</option>` : '') +
      sorted.map(({ a, km }) => `<option value="${a.id}">${esc(L(a))} · ${num(km, 1)} ${esc(t('unit.km'))}</option>`).join('');
    sel.value = state.geo ? '__me' : state.area;
  }

  function renderDelivery() {
    const el = $('#deliveryReadout');
    const d = deliveryInfo();
    if (state.geoError && !d) {
      el.innerHTML = `<p class="readout-msg">${esc(t('delivery.geoError'))}</p>`;
    } else if (!d) {
      el.innerHTML = '';
    } else {
      const eta = d.zone === 'beyond' ? t('delivery.far') : t('delivery.eta', etaRange(d.km));
      el.innerHTML = `<div class="readout-card">
        <span class="readout-km">${num(d.km, 1)}<small> ${esc(t('unit.km'))}</small></span>
        <span class="readout-zone">${esc(t('zone.' + d.zone))} · ${esc(d.label)}</span>
        <span class="${d.zone === 'beyond' ? 'readout-msg' : 'readout-eta'}">${esc(eta)}</span>
      </div>`;
    }
  }

  /* ---------- Order modes ---------- */
  function setMode(m) {
    state.mode = m;
    store.set('mode', m);
    $$('.tabs [role="tab"]').forEach(b => {
      const on = b.dataset.mode === m;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    ['delivery', 'kerbside', 'dine'].forEach(x => { $('#panel-' + x).hidden = x !== m; });
    if (drawerOpen) renderDrawer();
  }

  function renderTimes() {
    const sel = $('#timeSelect');
    const o = toMin(C.open), c0 = toMin(C.close);
    const c = c0 <= o ? c0 + 1440 : c0;
    const slots = [];
    for (let m = Math.ceil(o / 30) * 30; m <= c - 30; m += 30) slots.push(m);
    let avail = slots;
    if (state.dine.day === 'today') {
      const n = tbilisiNow();
      let now = n.h * 60 + n.m;
      if (c > 1440 && now < c - 1440) now += 1440;
      avail = slots.filter(m => m >= now + 30);
    }
    sel.innerHTML = avail.map(m => `<option value="${hhmm(m)}">${hhmm(m)}</option>`).join('');
    if (avail.some(m => hhmm(m) === state.dine.time)) sel.value = state.dine.time;
    else state.dine.time = sel.value || '';
    sel.disabled = !avail.length;
    $('#tableBtn').disabled = !avail.length;
    $('#icsBtn').disabled = !avail.length;
    $('#dineError').textContent = avail.length ? '' : t('dine.noTimes');
  }

  function renderDine() {
    $('#guestsOut').textContent = state.dine.guests;
    $$('#daySeg [data-day]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.day === state.dine.day)));
    $$('#seatSeg [data-seat]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.seat === state.dine.seat)));
  }
  const saveDine = () => store.set('dine', state.dine);

  function dineSummary() {
    const d = state.dine;
    const day = d.day === 'today' ? t('dine.today') : t('dine.tomorrow');
    return `${t('dine.guestsN', { n: d.guests })} · ${day} ${d.time}${d.seat === 'fire' ? ' · ' + t('dine.fire') : ''}`;
  }
  const carText = () => [state.plate.trim().toUpperCase(), state.car.trim()].filter(Boolean).join(', ');

  // Calendar file for the table request, in Tbilisi time (UTC+4).
  function downloadIcs() {
    const d = state.dine;
    if (!d.time) return;
    const now = new Date(Date.now() + 4 * 3600 * 1000);
    const [hh, mm] = d.time.split(':').map(Number);
    let dayOffset = d.day === 'tomorrow' ? 1 : 0;
    if (hh * 60 + mm < toMin(C.open)) dayOffset += 1; // after-midnight slots belong to the next calendar day
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + dayOffset, hh - 4, mm));
    const end = new Date(start.getTime() + 90 * 60000);
    const fmt = dt => dt.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const icsEsc = s => String(s).replace(/([,;\\])/g, '\\$1');
    const ics = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Burger Space//Table//EN', 'BEGIN:VEVENT',
      `UID:${Date.now()}@burgerspace`, `DTSTAMP:${fmt(new Date())}`, `DTSTART:${fmt(start)}`, `DTEND:${fmt(end)}`,
      `SUMMARY:${icsEsc(t('ics.summary', { n: d.guests }))}`,
      `LOCATION:${icsEsc('Burger Space, ' + t('visit.address'))}`,
      `DESCRIPTION:${icsEsc(t('ics.desc'))}`,
      'END:VEVENT', 'END:VCALENDAR'
    ].join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
    a.download = 'burger-space-table.ics';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  /* ---------- Links out ---------- */
  const waUrl = msg => `https://wa.me/${C.whatsapp}?text=${encodeURIComponent(msg)}`;
  const smsUrl = msg => `sms:${C.phone}?body=${encodeURIComponent(msg)}`;
  const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(C.mapsQuery)}`;
  const openWa = msg => window.open(waUrl(msg), '_blank', 'noopener');

  /* ---------- Menu ---------- */
  function matches(item, ignoreQuery) {
    const f = state.filters;
    const tags = item.tags || [];
    const types = TYPE_FILTERS.filter(x => f.has(x));
    if (types.length && !types.some(x => tags.includes(x))) return false;
    if (f.has('nobun') && !tags.includes('nobun')) return false;
    if (f.has('new') && !tags.includes('new')) return false;
    if (f.has('sale') && !item.was) return false;
    if (f.has('saved') && !state.favs.includes(item.id)) return false;
    if (!ignoreQuery && state.q) {
      const cat = CATS.find(c => c.id === item.cat);
      const hay = [item.name.ka, item.name.en, item.desc?.ka, item.desc?.en, item.meta?.ka, item.meta?.en,
        item.full?.ka, item.full?.en, cat?.ka, cat?.en].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(state.q)) return false;
    }
    return true;
  }

  const qtyInCart = id => state.cart.filter(l => l.id === id).reduce((a, l) => a + l.qty, 0);
  const PLUS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';

  function addBtn(item, sm) {
    const q = qtyInCart(item.id);
    return `<button type="button" class="add${sm ? ' sm' : ''}" data-add="${item.id}" aria-label="${esc(t('add', { name: L(item.name) }))}">${PLUS}${q ? `<span class="qty">${q}</span>` : ''}</button>`;
  }
  function sizeSeg(item, size) {
    const opts = item.sizes ? item.sizes.map((s, i) => [String(i), vol(s.vol)]) : [['big', 'BIG'], ['std', 'STD']];
    return `<div class="seg" role="group" aria-label="${esc(L(item.name))}">${opts.map(([v, lbl]) =>
      `<button type="button" data-size="${v}" aria-pressed="${v === size}">${esc(lbl)}</button>`).join('')}</div>`;
  }
  function priceHTML(item, size) {
    const was = wasOf(item, size);
    return (was ? `<s>${money(was)}</s>` : '') + money(priceOf(item, size));
  }
  function badgesHTML(item) {
    const tg = item.tags || [];
    const b = [];
    if (item.was) b.push(`<span class="badge sale">−${Math.round((1 - item.price / item.was) * 100)}%</span>`);
    if (tg.includes('popular')) b.push(`<span class="badge pop">★ ${esc(t('badge.popular'))}</span>`);
    if (tg.includes('new')) b.push(`<span class="badge new">${esc(t('badge.new'))}</span>`);
    if (tg.includes('lenten')) b.push(`<span class="badge">${esc(t('badge.lenten'))}</span>`);
    if (tg.includes('nobun')) b.push(`<span class="badge">${esc(t('badge.nobun'))}</span>`);
    if (tg.includes('age18')) b.push('<span class="badge">18+</span>');
    return b.length ? `<div class="badges">${b.join('')}</div>` : '';
  }

  const HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7z"/></svg>';
  function favBtn(item) {
    const on = state.favs.includes(item.id);
    return `<button type="button" class="fav" data-fav="${item.id}" aria-pressed="${on}" aria-label="${esc(t(on ? 'fav.remove' : 'fav.add', { name: L(item.name) }))}">${HEART}</button>`;
  }
  function toggleFav(id, btn) {
    const on = !state.favs.includes(id);
    state.favs = on ? [...state.favs, id] : state.favs.filter(x => x !== id);
    store.set('favs', state.favs);
    const name = L(byId[id].name);
    $$(`[data-fav="${id}"]`).forEach(b => {
      b.setAttribute('aria-pressed', String(on));
      b.setAttribute('aria-label', t(on ? 'fav.remove' : 'fav.add', { name }));
    });
    if (btn) { btn.classList.remove('pop-anim'); void btn.offsetWidth; btn.classList.add('pop-anim'); }
    toast(t(on ? 'toast.saved' : 'toast.unsaved', { name }));
    if (state.filters.has('saved')) renderMenu();
  }

  function cardHTML(item) {
    const size = currentSize(item);
    return `<article class="item" data-id="${item.id}">
      <div class="planet"><img src="${imgSrc(item)}" alt="" loading="lazy" width="104" height="104">${favBtn(item)}</div>
      <div class="item-body">
        <h4>${esc(L(item.name))}</h4>
        ${badgesHTML(item)}
        ${item.desc ? `<p class="desc">${esc(L(item.desc))}</p>` : ''}
        <div class="item-foot">
          <span class="price">${priceHTML(item, size)}</span>
          ${item.std ? sizeSeg(item, size) : ''}
          ${addBtn(item)}
        </div>
      </div>
    </article>`;
  }
  function moonHTML(item) {
    return `<div class="moon-item" data-id="${item.id}">
      <img src="${imgSrc(item)}" alt="" loading="lazy" width="52" height="52">
      <div><span class="nm">${esc(L(item.name))}</span><span class="price">${money(item.price)}</span></div>
      ${addBtn(item, true)}
    </div>`;
  }
  function rowHTML(item) {
    const size = currentSize(item);
    const meta = item.meta ? L(item.meta) : item.vol ? vol(item.vol) : '';
    return `<li class="row" data-id="${item.id}">
      <div class="row-main">
        <span class="nm">${esc(L(item.name))}</span>
        ${meta ? `<span class="meta">${esc(meta)}</span>` : ''}
        ${item.sizes ? sizeSeg(item, size) : ''}
      </div>
      <span class="price">${money(priceOf(item, size))}</span>
      ${addBtn(item, true)}
    </li>`;
  }

  function renderMenu() {
    let html = '', rail = '', bar = '', total = 0;
    const flushBar = () => { if (bar) { html += `<div class="bar">${bar}</div>`; bar = ''; } };
    const byPrice = it => priceOf(it, currentSize(it));
    for (const cat of CATS) {
      const items = MENU.filter(i => i.cat === cat.id && matches(i));
      if (!items.length) continue;
      if (state.sort === 'asc') items.sort((a, b) => byPrice(a) - byPrice(b));
      if (state.sort === 'desc') items.sort((a, b) => byPrice(b) - byPrice(a));
      total += items.length;
      rail += `<a href="#cat-${cat.id}" data-cat="${cat.id}">${esc(L(cat))}<sup>${items.length}</sup></a>`;
      const head = `<div class="cat-head"><h3>${esc(L(cat))}</h3>${cat.age ? '<span class="cat-age">18+</span>' : ''}</div>` +
        (cat.note ? `<p class="cat-note">${esc(L(cat.note))}</p>` : '');
      if (cat.type === 'list') {
        bar += `<section class="cat" id="cat-${cat.id}">${head}<ul class="rows">${items.map(rowHTML).join('')}</ul></section>`;
        continue;
      }
      flushBar();
      const inner = cat.type === 'moons'
        ? `<div class="moons">${items.map(moonHTML).join('')}</div>`
        : `<div class="grid">${items.map(cardHTML).join('')}</div>`;
      html += `<section class="cat" id="cat-${cat.id}">${head}${inner}</section>`;
    }
    flushBar();
    if (!total) {
      const onlySaved = state.filters.size === 1 && state.filters.has('saved') && !state.q;
      const msg = onlySaved && !state.favs.length ? t('menu.emptySaved')
        : state.q ? t('menu.emptyQ', { q: state.qRaw.trim() }) : t('menu.emptyF');
      html = `<div class="empty"><p>${esc(msg)}</p>
        <button type="button" class="btn" data-action="clear-filters">${btnInner(t('menu.clear'))}</button></div>`;
    }
    $('#menuBody').innerHTML = html;
    $('#railInner').innerHTML = rail;
    $('#rail').hidden = !total;
    $('#menuCount').textContent = t('menu.count', { n: total });
    observeSections();
  }

  function renderPopular() {
    $('#popList').innerHTML = C.mostOrdered.map(id => byId[id]).filter(Boolean).map((it, i) => {
      const size = currentSize(it);
      return `<li class="pop-item" data-id="${it.id}">
        <span class="pop-rank">${i + 1}</span>
        <img src="${imgSrc(it)}" alt="" loading="lazy" width="72" height="72">
        <div><span class="pop-name">${esc(L(it.name))}</span><span class="pop-price">${money(priceOf(it, size))}</span></div>
        ${addBtn(it)}
      </li>`;
    }).join('');
  }

  function refreshAddBadges() {
    $$('[data-add]').forEach(b => {
      const q = qtyInCart(b.dataset.add);
      let s = b.querySelector('.qty');
      if (q) {
        if (!s) { s = document.createElement('span'); s.className = 'qty'; b.appendChild(s); }
        s.textContent = q;
      } else if (s) s.remove();
    });
  }

  let spy = null;
  function observeSections() {
    if (spy) spy.disconnect();
    const rail = $('#railInner');
    const links = new Map($$('a', rail).map(a => [a.dataset.cat, a]));
    spy = new IntersectionObserver(entries => {
      entries.forEach(en => {
        if (!en.isIntersecting) return;
        const a = links.get(en.target.id.slice(4));
        if (!a || a.classList.contains('active')) return;
        links.forEach(x => x.classList.remove('active'));
        a.classList.add('active');
        const left = a.getBoundingClientRect().left - rail.getBoundingClientRect().left + rail.scrollLeft;
        rail.scrollTo({ left: left - rail.clientWidth / 2 + a.clientWidth / 2, behavior: reduceMotion ? 'auto' : 'smooth' });
      });
    }, { rootMargin: '-30% 0px -65% 0px' });
    $$('#menuBody .cat').forEach(sec => spy.observe(sec));
  }

  function clearFilters() {
    state.filters.clear();
    state.q = state.qRaw = '';
    $('#q').value = '';
    $$('#filters [data-filter]').forEach(b => b.setAttribute('aria-pressed', 'false'));
    renderMenu();
  }

  /* ---------- Cart ---------- */
  function totals() {
    let sum = 0, saved = 0, count = 0;
    for (const l of state.cart) {
      const it = byId[l.id];
      const p = priceOf(it, l.size);
      sum += p * l.qty;
      const w = wasOf(it, l.size);
      if (w) saved += (w - p) * l.qty;
      count += l.qty;
    }
    return { sum: round2(sum), saved: round2(saved), count };
  }

  function addToCart(id, size = '') {
    const key = id + '|' + size;
    const line = state.cart.find(l => l.key === key);
    if (line) line.qty++;
    else state.cart.push({ key, id, size, qty: 1 });
    cartChanged();
    toast(t('toast.added', { name: lineName(byId[id], size) }));
    const btn = $('#cartBtn');
    btn.classList.remove('bump'); void btn.offsetWidth; btn.classList.add('bump');
  }
  function setQty(key, qty) {
    const line = state.cart.find(l => l.key === key);
    if (!line) return;
    line.qty = qty;
    if (qty <= 0) state.cart = state.cart.filter(l => l !== line);
    cartChanged();
  }
  function cartChanged() {
    store.set('cart', state.cart);
    renderCartButton();
    refreshAddBadges();
    if (drawerOpen) renderDrawer();
  }
  function renderCartButton() {
    const tt = totals();
    $('#cartCount').textContent = tt.count;
    $('#cartBtn').classList.toggle('has', tt.count > 0);
    $('#mbCount').textContent = tt.count;
    $('#mbTotal').textContent = money(tt.sum);
    $('#mobileBar').hidden = !tt.count || drawerOpen;
  }

  function modeDetailsHTML() {
    if (state.mode === 'delivery') {
      const d = deliveryInfo();
      const sub = d
        ? `${d.label} · ${num(d.km, 1)} ${t('unit.km')} · ${d.zone === 'beyond' ? t('zone.beyond') : t('delivery.eta', etaRange(d.km))}`
        : t('cart.noArea');
      return `<p class="sub">${esc(sub)}</p>
        <label class="field"><span>${esc(t('delivery.address'))}</span>
        <textarea rows="2" data-sync="address" placeholder="${esc(t('delivery.addressPh'))}">${esc(state.address)}</textarea></label>`;
    }
    if (state.mode === 'kerbside') {
      return `<div class="field-row" style="margin:0">
        <label class="field"><span>${esc(t('kerb.plate'))}</span><input type="text" data-sync="plate" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="${esc(t('kerb.platePh'))}" value="${esc(state.plate)}"></label>
        <label class="field grow"><span>${esc(t('kerb.car'))}</span><input type="text" data-sync="car" autocomplete="off" placeholder="${esc(t('kerb.carPh'))}" value="${esc(state.car)}"></label>
      </div>`;
    }
    return `<p class="sub" style="margin:0">${esc(dineSummary())}</p>`;
  }

  function renderDrawer() {
    const body = $('#drawerBody'), foot = $('#drawerFoot');
    const focusSel = focusSelector(document.activeElement);
    if (!state.cart.length) {
      const last = state.last && cleanCart(state.last.cart);
      const repeat = last && last.length
        ? `<button type="button" class="link-btn repeat" data-repeat>${esc(t('cart.repeat'))}
            <small>${esc(t('cart.repeatSub', { n: last.reduce((a, l) => a + l.qty, 0), x: gel(state.last.total) }))}</small></button>`
        : '';
      body.innerHTML = `<div class="cart-empty">
        <div class="empty-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14l-1.2 12H6.2z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg></div>
        <p>${esc(t('cart.empty'))}</p>
        <a class="btn btn-accent" href="#menu" data-close>${btnInner(t('cart.browse'))}</a>
        ${repeat}</div>`;
      foot.innerHTML = '';
      if (focusSel === '[data-clear]') $('#drawerClose').focus();
      return;
    }
    const lines = state.cart.map(l => {
      const it = byId[l.id];
      const name = lineName(it, l.size);
      const unit = priceOf(it, l.size);
      const pic = it.img ? `<img src="${imgSrc(it)}" alt="">` : `<span class="dot">${esc(L(it.name).charAt(0))}</span>`;
      const sub = [sizeLabel(it, l.size) || (it.vol ? vol(it.vol) : ''), money(unit)].filter(Boolean).join(' · ');
      return `<div class="line" data-key="${esc(l.key)}">
        ${pic}
        <div><div class="nm">${esc(L(it.full || it.name))}</div><div class="sub">${esc(sub)}</div></div>
        <div class="line-right">
          <span class="price">${money(unit * l.qty)}</span>
          <div class="qty-ctl">
            <button type="button" data-qty="-1" aria-label="${esc(t(l.qty > 1 ? 'cart.less' : 'cart.remove', { name }))}">−</button>
            <span>${l.qty}</span>
            <button type="button" data-qty="1" aria-label="${esc(t('cart.more', { name }))}">+</button>
          </div>
        </div>
      </div>`;
    }).join('');

    const tt = totals();
    const each = state.split > 1 ? `<span class="split-each mono">${esc(t('cart.each', { x: money(round2(tt.sum / state.split)) }))}</span>` : '<span></span>';

    body.innerHTML = `${lines}
      <div class="split">
        <span>${esc(t('cart.split'))}</span>
        <div class="stepper" role="group" aria-label="${esc(t('cart.split'))}">
          <button type="button" data-split="-1" aria-label="−">−</button>
          <output class="mono">${state.split}</output>
          <button type="button" data-split="1" aria-label="+">+</button>
        </div>
        <span>${esc(t('cart.people'))}</span>
        ${each}
      </div>
      <div class="mode-box">
        <div class="mode-box-head"><strong>${esc(t('tab.' + state.mode))}</strong>
          <button type="button" class="link-btn" data-change-mode>${esc(t('cart.change'))}</button></div>
        ${modeDetailsHTML()}
        <p class="field-error" id="drawerError" role="alert"></p>
      </div>
      <div class="drawer-tools">
        <button type="button" class="link-btn" data-share>
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4"/></svg>
          ${esc(t('cart.share'))}</button>
        <button type="button" class="link-btn" data-clear>${esc(t('cart.clear'))}</button>
      </div>`;

    const conv = state.cur !== 'GEL' ? `≈ ${money(tt.sum)}` : '';
    foot.innerHTML = `
      <div class="totals"><span class="lbl">${esc(t('cart.total'))}</span><span class="price">${gel(tt.sum)}</span></div>
      <div class="totals-sub"><span class="saved">${tt.saved > 0 ? esc(t('cart.saved', { x: gel(tt.saved) })) : ''}</span><span>${esc(conv)}</span></div>
      <div class="send-grid">
        <button type="button" class="btn btn-accent wide" data-send="wa">${btnInner(t('cart.wa'))}</button>
        <button type="button" class="btn" data-send="sms">${btnInner(t('cart.smsShort'))}</button>
        <a class="btn" href="tel:${C.phone}">${btnInner(t('cart.call'))}</a>
      </div>
      <p class="fine">${esc(t('cart.note'))} <a href="${C.mayber}" target="_blank" rel="noopener">${esc(t('cart.mayber'))} ↗</a></p>`;

    if (focusSel) { const el = $(focusSel, $('#drawer')); (el || $('#drawerClose')).focus(); }
  }

  // Keeps keyboard focus on the same control after the drawer re-renders.
  function focusSelector(el) {
    if (!el || !$('#drawer').contains(el)) return null;
    const line = el.closest('[data-key]');
    if (line && el.dataset.qty) return `[data-key="${CSS.escape(line.dataset.key)}"] [data-qty="${el.dataset.qty}"]`;
    if (el.dataset.split) return `[data-split="${el.dataset.split}"]`;
    if (el.matches('[data-clear]')) return '[data-clear]';
    return null;
  }

  /* ---------- Shared order links: #order=id.size.qty,... ---------- */
  function shareUrl() {
    const code = state.cart.map(l => `${l.id}.${l.size || '-'}.${l.qty}`).join(',');
    return location.href.split('#')[0] + '#order=' + encodeURIComponent(code);
  }
  function parseSharedOrder() {
    const m = location.hash.match(/^#order=(.+)$/);
    if (!m) return null;
    let raw = '';
    try { raw = decodeURIComponent(m[1]); } catch (e) { return null; }
    const lines = raw.split(',').map(part => {
      const [id, size, qty] = part.split('.');
      const it = byId[id];
      const n = Math.min(50, parseInt(qty, 10) || 0);
      if (!it || n < 1) return null;
      const s = size === '-' ? '' : size;
      const validSize = it.sizes ? (it.sizes[+s] ? s : '0') : it.std ? (s === 'std' ? 'std' : 'big') : '';
      return { key: id + '|' + validSize, id, size: validSize, qty: n };
    }).filter(Boolean);
    return lines.length ? lines : null;
  }
  async function shareOrder() {
    const url = shareUrl();
    if (navigator.share) {
      try { await navigator.share({ title: t('share.title'), url }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(url); toast(t('toast.linkCopied')); }
    catch (e) { window.prompt(t('cart.share'), url); }
  }
  function mergeLines(lines) {
    for (const l of lines) {
      const existing = state.cart.find(x => x.key === l.key);
      if (existing) existing.qty += l.qty; else state.cart.push({ ...l });
    }
    cartChanged();
  }
  function rememberOrder() {
    state.last = { cart: state.cart.map(l => ({ ...l })), total: totals().sum };
    store.set('last', state.last);
  }

  function orderMessage() {
    const out = [t('msg.hello'), ''];
    for (const l of state.cart) {
      const it = byId[l.id];
      out.push(`${l.qty} × ${lineName(it, l.size)} — ${gel(priceOf(it, l.size) * l.qty)}`);
    }
    out.push('', `${t('msg.total')}: ${gel(totals().sum)}`, '');
    if (state.mode === 'delivery') {
      const d = deliveryInfo();
      out.push(t('tab.delivery') + (d ? ` — ${d.label} (~${num(d.km, 1)} ${t('unit.km')})` : ''));
      out.push(`${t('msg.address')}: ${state.address.trim()}`);
    } else if (state.mode === 'kerbside') {
      out.push(t('tab.kerbside'), `${t('msg.car')}: ${carText()}`);
    } else {
      out.push(`${t('tab.dine')} — ${dineSummary()}`);
    }
    return out.join('\n');
  }

  function validateOrder() {
    const err = $('#drawerError');
    if (state.mode === 'delivery' && !state.address.trim()) {
      err.textContent = t('cart.needAddress');
      $('#drawer [data-sync="address"]').focus();
      return false;
    }
    if (state.mode === 'kerbside' && !state.plate.trim()) {
      err.textContent = t('cart.needPlate');
      $('#drawer [data-sync="plate"]').focus();
      return false;
    }
    err.textContent = '';
    return true;
  }

  /* ---------- Drawer open / close ---------- */
  let drawerOpen = false, lastFocus = null;
  function openDrawer() {
    drawerOpen = true;
    lastFocus = document.activeElement;
    renderDrawer();
    const d = $('#drawer');
    d.inert = false;
    d.classList.add('open');
    $('#scrim').classList.add('open');
    document.body.style.overflow = 'hidden';
    renderCartButton();
    setTimeout(() => $('#drawerClose').focus(), 60);
  }
  function closeDrawer(restoreFocus = true) {
    if (!drawerOpen) return;
    drawerOpen = false;
    const d = $('#drawer');
    d.classList.remove('open');
    d.inert = true;
    $('#scrim').classList.remove('open');
    document.body.style.overflow = '';
    renderCartButton();
    if (restoreFocus && lastFocus && lastFocus.focus) lastFocus.focus();
  }

  /* ---------- Random pick ---------- */
  let pickTimer = null, picked = null;
  function pickPool() {
    let pool = MENU.filter(i => BURGER_CATS.includes(i.cat) && matches(i, true));
    if (!pool.length) pool = MENU.filter(i => BURGER_CATS.includes(i.cat));
    return pool;
  }
  function showPick(it) {
    picked = it;
    const size = currentSize(it);
    $('#pickImg').src = imgSrc(it);
    $('#pickName').textContent = L(it.name);
    $('#pickDesc').textContent = it.desc ? L(it.desc) : '';
    $('#pickPrice').innerHTML = priceHTML(it, size);
  }
  function spin() {
    const dlg = $('#pickDialog');
    const pool = pickPool();
    const final = pool[Math.floor(Math.random() * pool.length)];
    clearTimeout(pickTimer);
    if (reduceMotion || pool.length < 2) { dlg.classList.remove('spinning'); showPick(final); return; }
    pool.forEach(it => { const im = new Image(); im.src = imgSrc(it); });
    dlg.classList.add('spinning');
    $('#pickTitle').textContent = t('pick.choosing');
    let i = 0, delay = 60, prev = null;
    const steps = 16;
    const step = () => {
      if (i >= steps) {
        dlg.classList.remove('spinning');
        $('#pickTitle').textContent = t('pick.title');
        showPick(final);
        return;
      }
      let it;
      do { it = pool[Math.floor(Math.random() * pool.length)]; } while (it === prev);
      prev = it;
      $('#pickImg').src = imgSrc(it);
      $('#pickName').textContent = L(it.name);
      i++;
      delay *= 1.15;
      pickTimer = setTimeout(step, delay);
    };
    step();
  }

  /* ---------- Toast ---------- */
  let toastTimer = null;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
  }

  /* ---------- Theme ---------- */
  function applyTheme() {
    const dark = state.theme === 'dark';
    if (dark) document.documentElement.dataset.theme = 'dark';
    else delete document.documentElement.dataset.theme;
    $('#themeBtn').setAttribute('aria-label', t(dark ? 'theme.light' : 'theme.dark'));
    setBtnLabel($('#themeBtnM'), t(dark ? 'theme.lightShort' : 'theme.darkShort'));
    $('meta[name="theme-color"]').setAttribute('content', dark ? '#2A2B2E' : '#F6F6F3');
  }

  /* ---------- Language ---------- */
  function applyLang() {
    document.documentElement.lang = state.lang;
    document.title = state.lang === 'ka' ? 'Burger Space — ბურგერ-ბარი თბილისში' : 'Burger Space — Burger bar in Tbilisi';
    $$('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
    $$('[data-i18n-ph]').forEach(el => { el.placeholder = t(el.dataset.i18nPh); });
    $$('[data-i18n-aria]').forEach(el => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
    $$('.btn[data-label]').forEach(b => setBtnLabel(b, t(b.dataset.label)));
    $$('[data-lang]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.lang === state.lang)));
    applyTheme();
    renderPopular();
    $('#ratingLabel').textContent = t('hero.rating', { n: C.reviews });
    $('#reviewsLabel').textContent = t('visit.reviews', { n: C.reviews });
    $('#hoursText').textContent = t('visit.hours', { o: C.open, c: C.close });
    renderAreaSelect();
    renderDelivery();
    renderTimes();
    renderMenu();
    renderCartButton();
    if (drawerOpen) renderDrawer();
    tickStatus();
  }

  /* ---------- Wiring ---------- */
  function bind() {
    // Header
    $$('[data-lang]').forEach(b => b.addEventListener('click', () => {
      state.lang = b.dataset.lang;
      store.set('lang', state.lang);
      applyLang();
    }));
    const toggleTheme = () => {
      state.theme = state.theme === 'dark' ? 'light' : 'dark';
      store.set('theme', state.theme);
      applyTheme();
    };
    $('#themeBtn').addEventListener('click', toggleTheme);
    $('#themeBtnM').addEventListener('click', toggleTheme);

    // Phone menu
    const menuBtn = $('#menuBtn'), mnav = $('#mobileNav');
    const setNav = open => {
      mnav.hidden = !open;
      menuBtn.setAttribute('aria-expanded', String(open));
      menuBtn.setAttribute('aria-label', t(open ? 'nav.close' : 'nav.open'));
    };
    menuBtn.addEventListener('click', e => { e.stopPropagation(); setNav(mnav.hidden); });
    mnav.addEventListener('click', e => { if (e.target.closest('a')) setNav(false); });
    document.addEventListener('click', e => { if (!mnav.hidden && !mnav.contains(e.target)) setNav(false); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !mnav.hidden) { setNav(false); menuBtn.focus(); } });
    window.matchMedia('(min-width: 901px)').addEventListener('change', e => { if (e.matches) setNav(false); });
    $('#cartBtn').addEventListener('click', openDrawer);
    $('#mobileBar').addEventListener('click', openDrawer);
    const top = $('#top');
    const onScroll = () => top.classList.toggle('scrolled', window.scrollY > 8);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    $$('[data-go-mode]').forEach(a => a.addEventListener('click', () => setMode(a.dataset.goMode)));

    // Tabs
    const tabs = $$('.tabs [role="tab"]');
    tabs.forEach((b, i) => {
      b.addEventListener('click', () => setMode(b.dataset.mode));
      b.addEventListener('keydown', e => {
        const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!dir) return;
        e.preventDefault();
        const next = tabs[(i + dir + tabs.length) % tabs.length];
        setMode(next.dataset.mode);
        next.focus();
      });
    });

    // Delivery
    $('#areaSelect').addEventListener('change', e => {
      const v = e.target.value;
      if (v !== '__me') { state.geo = null; state.area = v; store.set('area', v); }
      state.geoError = false;
      renderAreaSelect();
      renderDelivery();
      if (drawerOpen) renderDrawer();
    });
    $('#locateBtn').addEventListener('click', () => {
      const btn = $('#locateBtn');
      const fail = () => {
        state.geoError = true;
        setBtnLabel(btn, t('delivery.locate'));
        btn.disabled = false;
        renderDelivery();
      };
      if (!navigator.geolocation) return fail();
      setBtnLabel(btn, t('delivery.locating'));
      btn.disabled = true;
      navigator.geolocation.getCurrentPosition(pos => {
        state.geo = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        state.geoError = false;
        state.area = '';
        store.set('area', '');
        setBtnLabel(btn, t('delivery.locate'));
        btn.disabled = false;
        renderAreaSelect();
        renderDelivery();
      }, fail, { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 });
    });

    // Synced inputs (launch panel and drawer share the same values)
    document.addEventListener('input', e => {
      const el = e.target;
      const key = el.dataset && el.dataset.sync;
      if (!key) return;
      state[key] = el.value;
      store.set(key, el.value);
      $$(`[data-sync="${key}"]`).forEach(o => { if (o !== el) o.value = el.value; });
      if (key === 'plate') $('#kerbError').textContent = '';
    });

    // Kerbside
    const outside = viaWa => {
      if (!state.plate.trim()) {
        $('#kerbError').textContent = t('kerb.need');
        $('#plateInput').focus();
        return;
      }
      const msg = t('msg.outside', { car: carText() });
      if (viaWa) openWa(msg); else window.location.href = smsUrl(msg);
    };
    $('#outsideBtn').addEventListener('click', () => outside(false));
    $('#outsideWa').addEventListener('click', () => outside(true));

    // Dine in
    $('#panel-dine').addEventListener('click', e => {
      const stepB = e.target.closest('[data-step]');
      if (stepB) {
        state.dine.guests = Math.min(20, Math.max(1, state.dine.guests + Number(stepB.dataset.step)));
        saveDine(); renderDine();
      }
      const dayB = e.target.closest('[data-day]');
      if (dayB) { state.dine.day = dayB.dataset.day; saveDine(); renderDine(); renderTimes(); }
      const seatB = e.target.closest('[data-seat]');
      if (seatB) { state.dine.seat = seatB.dataset.seat; saveDine(); renderDine(); }
    });
    $('#timeSelect').addEventListener('change', e => { state.dine.time = e.target.value; saveDine(); });
    $('#nameInput').addEventListener('input', e => { state.dine.name = e.target.value; saveDine(); $('#dineError').textContent = ''; });
    $('#tableBtn').addEventListener('click', () => {
      const d = state.dine;
      if (!d.name.trim()) { $('#dineError').textContent = t('dine.needName'); $('#nameInput').focus(); return; }
      const day = (d.day === 'today' ? t('dine.today') : t('dine.tomorrow'));
      openWa(t('msg.table', {
        n: d.guests, day: state.lang === 'en' ? day.toLowerCase() : day, time: d.time,
        seat: d.seat === 'fire' ? t('msg.fire') : '', name: d.name.trim()
      }));
    });
    $('#icsBtn').addEventListener('click', downloadIcs);

    // Menu controls
    let qTimer = null;
    $('#q').addEventListener('input', e => {
      clearTimeout(qTimer);
      qTimer = setTimeout(() => {
        state.qRaw = e.target.value;
        state.q = e.target.value.trim().toLowerCase();
        renderMenu();
      }, 120);
    });
    $('#filters').addEventListener('click', e => {
      const b = e.target.closest('[data-filter]');
      if (!b) return;
      const f = b.dataset.filter;
      if (state.filters.has(f)) state.filters.delete(f); else state.filters.add(f);
      b.setAttribute('aria-pressed', String(state.filters.has(f)));
      renderMenu();
    });
    $$('#curSeg [data-cur]').forEach(b => b.addEventListener('click', () => {
      state.cur = b.dataset.cur;
      store.set('cur', state.cur);
      $$('#curSeg [data-cur]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      renderMenu();
      renderPopular();
      renderCartButton();
      if (drawerOpen) renderDrawer();
    }));
    $('#sortSelect').addEventListener('change', e => { state.sort = e.target.value; renderMenu(); });
    // "/" jumps to search, like on most sites with a search box
    document.addEventListener('keydown', e => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = (document.activeElement && document.activeElement.tagName) || '';
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag) || drawerOpen || $('#pickDialog').open) return;
      e.preventDefault();
      $('#q').focus({ preventScroll: true });
      $('#menu').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
    });
    $('#popList').addEventListener('click', e => {
      const addB = e.target.closest('[data-add]');
      if (addB) { const it = byId[addB.dataset.add]; addToCart(it.id, currentSize(it)); }
    });
    $('#menuBody').addEventListener('click', e => {
      const addB = e.target.closest('[data-add]');
      if (addB) { const it = byId[addB.dataset.add]; addToCart(it.id, currentSize(it)); return; }
      const favB = e.target.closest('[data-fav]');
      if (favB) { toggleFav(favB.dataset.fav, favB); return; }
      const sizeB = e.target.closest('[data-size]');
      if (sizeB) {
        const host = sizeB.closest('[data-id]');
        const it = byId[host.dataset.id];
        state.sizes[it.id] = sizeB.dataset.size;
        const size = currentSize(it);
        $$('[data-size]', host).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.size === size)));
        $('.price', host).innerHTML = it.sizes ? money(priceOf(it, size)) : priceHTML(it, size);
        return;
      }
      if (e.target.closest('[data-action="clear-filters"]')) clearFilters();
    });

    // Pick for me
    const dlg = $('#pickDialog');
    $('#pickBtn').addEventListener('click', () => { if (!dlg.open) dlg.showModal(); spin(); });
    $('#pickAgain').addEventListener('click', spin);
    $('#pickClose').addEventListener('click', () => dlg.close());
    $('#pickAdd').addEventListener('click', () => { if (picked) addToCart(picked.id, currentSize(picked)); dlg.close(); });
    dlg.addEventListener('close', () => { clearTimeout(pickTimer); dlg.classList.remove('spinning'); $('#pickTitle').textContent = t('pick.title'); });
    dlg.addEventListener('click', e => {
      if (e.target !== dlg) return;
      const r = dlg.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dlg.close();
    });

    // Drawer
    $('#drawerClose').addEventListener('click', () => closeDrawer());
    $('#scrim').addEventListener('click', () => closeDrawer());
    $('#drawer').addEventListener('click', e => {
      const q = e.target.closest('[data-qty]');
      if (q) {
        const key = q.closest('[data-key]').dataset.key;
        const line = state.cart.find(l => l.key === key);
        if (line) setQty(key, line.qty + Number(q.dataset.qty));
        return;
      }
      const sp = e.target.closest('[data-split]');
      if (sp) { state.split = Math.min(12, Math.max(1, state.split + Number(sp.dataset.split))); renderDrawer(); return; }
      if (e.target.closest('[data-clear]')) { state.cart = []; state.split = 1; cartChanged(); return; }
      if (e.target.closest('[data-share]')) { shareOrder(); return; }
      if (e.target.closest('[data-repeat]')) {
        if (state.last) mergeLines(cleanCart(state.last.cart));
        return;
      }
      if (e.target.closest('[data-close]')) { closeDrawer(false); return; }
      if (e.target.closest('[data-change-mode]')) {
        closeDrawer(false);
        $('#launch').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
        setTimeout(() => $('.tabs [aria-selected="true"]').focus({ preventScroll: true }), 400);
        return;
      }
      const send = e.target.closest('[data-send]');
      if (send) {
        if (!validateOrder()) return;
        const msg = orderMessage();
        rememberOrder();
        if (send.dataset.send === 'wa') openWa(msg); else window.location.href = smsUrl(msg);
      }
    });

    // Shared order banner
    $('#shareAccept').addEventListener('click', () => {
      if (pendingShare) { mergeLines(pendingShare); toast(t('toast.shareAdded')); }
      closeShareBanner();
      openDrawer();
    });
    $('#shareIgnore').addEventListener('click', closeShareBanner);
    document.addEventListener('keydown', e => {
      if (!drawerOpen) return;
      if (e.key === 'Escape') { closeDrawer(); return; }
      if (e.key !== 'Tab') return;
      const f = $$('#drawer button, #drawer a[href], #drawer input, #drawer textarea').filter(x => !x.disabled && x.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });

    // Visit
    $('#copyBtn').addEventListener('click', async () => {
      const text = 'Burger Space, ' + t('visit.address');
      try { await navigator.clipboard.writeText(text); }
      catch (err) {
        const ta = document.createElement('textarea');
        ta.value = text; document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); } catch (e2) { /* ignore */ }
        ta.remove();
      }
      toast(t('toast.copied'));
    });
  }

  let pendingShare = null;
  function closeShareBanner() {
    pendingShare = null;
    $('#shareBanner').hidden = true;
    history.replaceState(null, '', location.pathname + location.search);
  }
  function checkSharedOrder() {
    pendingShare = parseSharedOrder();
    if (!pendingShare) return;
    const n = pendingShare.reduce((a, l) => a + l.qty, 0);
    $('#shareText').textContent = t('share.found', { n });
    $('#shareBanner').hidden = false;
  }

  function init() {
    $$('.btn').forEach(enhanceButton);
    $('#directionsBtn').href = directionsUrl;
    $('#kerbDirections').href = directionsUrl;
    $('#tableCall').href = 'tel:' + C.phone;
    $('#mayberLink').href = C.mayber;
    $('#mapFrame').src = `https://maps.google.com/maps?q=${encodeURIComponent(C.mapsQuery)}&z=16&output=embed&hl=${state.lang}`;

    $$('[data-sync]').forEach(el => { el.value = state[el.dataset.sync] || ''; });
    $('#nameInput').value = state.dine.name;
    $$('#curSeg [data-cur]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.cur === state.cur)));

    bind();
    setMode(state.mode);
    renderDine();
    applyLang();
    checkSharedOrder();
    window.addEventListener('hashchange', checkSharedOrder);

    setInterval(tickStatus, 15000);
    setInterval(() => { if (state.dine.day === 'today') renderTimes(); }, 60000);
  }

  init();
})();
