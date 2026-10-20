/* FoodLoop – vanilla JS prototype. All data lives in this browser's localStorage (demo only). */
(() => {
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const IC = (n, s = 16) => `<i data-lucide="${n}" style="width:${s}px;height:${s}px"></i>`;
const icons = () => window.lucide && lucide.createIcons();

const KEY = 'foodloop.v1';
const ORIGIN = { lat: 12.9716, lng: 77.5946 };           // demo start point (campus gate), not GPS
const KG_PER_SERVING = 0.4;
const CATS = { 'Cooked Meals':'🍛','Bakery':'🥖','Fruits & Vegetables':'🍅','Packaged Food':'📦','Event Surplus':'🎪','Other Edible Food':'🍱' };
const ST = { available:'Available', pending:'Request pending', accepted:'Accepted – ready to collect', completed:'Completed', cancelled:'Cancelled', expired:'Expired' };
const stCls = s => ({available:'status-available',pending:'status-pending',accepted:'status-pending',completed:'status-done'}[s] || 'status-bad');
const H = h => new Date(Date.now() + h * 36e5).toISOString();
const RECIPIENT_CAPACITY = 60; // demo pickup capacity in servings

/* ---------- Data layer ---------- */
function seed() {
  const L = (id, title, cat, diet, servings, allergens, org, made, dl, dx, dy, address, handling, desc) =>
    ({ id, title, cat, diet, servings, allergens, org, made: H(made), deadline: H(dl), lat: ORIGIN.lat + dx, lng: ORIGIN.lng + dy,
       address, handling, desc, phone: '9800000000', status: 'available', code: null, sample: true });
  return {
    listings: [
      L('l1','Vegetable pulao','Cooked Meals','veg',60,'','Campus Canteen',-1.5,3,.004,.006,'Main Canteen, College Campus, Bengaluru','Keep hot. Eat within 3 hours.','Freshly cooked pulao in covered steel containers.'),
      L('l2','Chicken curry and rice','Cooked Meals','nonveg',40,'','Hostel Mess B',-1,2,-.005,.004,'Hostel Block B Mess, College Campus, Bengaluru','Keep hot. Do not refrigerate and reheat twice.','Dinner leftovers from the evening batch.'),
      L('l3','Fresh bread loaves','Bakery','veg',30,'Gluten, milk','Sunrise Bakery',-4,6,.008,-.006,'Sunrise Bakery, MG Road, Bengaluru','Store dry at room temperature.','Unsold loaves from today, packed in paper bags.'),
      L('l4','Seasonal fruit boxes','Fruits & Vegetables','veg',25,'','GreenMart Grocers',-5,20,-.009,-.007,'GreenMart, Indiranagar, Bengaluru','Keep cool and out of the sun.','Slightly bruised but good fruit, ready to eat today.'),
      L('l5','Fest snack packs','Event Surplus','veg',120,'Nuts','Cultural Fest Team',-2,1.2,.002,-.009,'Open Air Theatre, College Campus, Bengaluru','Sealed packs. Keep dry.','Sealed snack packs left after the cultural fest.'),
      L('l6','Biscuits and juice cartons','Packaged Food','veg',80,'Gluten','City Food Mart',-24,48,-.003,.011,'City Food Mart, Koramangala, Bengaluru','Sealed. Check expiry on pack.','Sealed packets nearing their best-before date.')
    ],
    orgs: [
      { id:'o1', name:'Campus Canteen', type:'Food donor', status:'verified' },
      { id:'o2', name:'Hostel Mess B', type:'Food donor', status:'verified' },
      { id:'o3', name:'Cultural Fest Team', type:'Food donor', status:'verified' },
      { id:'o4', name:'Sunrise Bakery', type:'Food donor', status:'pending' },
      { id:'o5', name:'GreenMart Grocers', type:'Food donor', status:'pending' },
      { id:'o6', name:'Hope Community Kitchen', type:'NGO / community kitchen', status:'pending' }
    ],
    done: [
      { title:'Bread and buns', cat:'Bakery', servings:30, at:H(-72), sample:true },
      { title:'Veg biryani', cat:'Cooked Meals', servings:50, at:H(-48), sample:true },
      { title:'Fruit crates', cat:'Fruits & Vegetables', servings:20, at:H(-26), sample:true }
    ],
    log: [{ t: H(-1), m: 'Demo data loaded' }],
    my: null
  };
}
let S;
try { S = JSON.parse(localStorage.getItem(KEY)); } catch (e) { S = null; }
if (!S || !S.listings) S = seed();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} };
const log = m => { S.log.unshift({ t: new Date().toISOString(), m }); S.log = S.log.slice(0, 30); };
const byId = id => S.listings.find(l => l.id === id);
const isVerified = name => S.orgs.some(o => o.name.toLowerCase() === String(name).toLowerCase() && o.status === 'verified');
const eff = l => (l.status === 'available' && Date.now() > new Date(l.deadline)) ? 'expired' : l.status;

/* ---------- Helpers ---------- */
let me = null; // user location (only after consent)
const origin = () => me || ORIGIN;
const rad = x => x * Math.PI / 180;
function km(a, b) {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat/2)**2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng/2)**2;
  return 12742 * Math.asin(Math.sqrt(h));
}
const dist = l => km(origin(), l);
const fmtT = iso => {
  const d = new Date(iso), t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? t : d.toLocaleDateString([], { weekday: 'short' }) + ' ' + t;
};
const freshText = l => `${l.cat === 'Cooked Meals' ? 'Cooked' : 'Ready'} at ${fmtT(l.made)} • Collect before ${fmtT(l.deadline)}`;
const soon = l => { const m = (new Date(l.deadline) - Date.now()) / 6e4; return m > 0 && m < 90; };
const walkMins = l => Math.max(1, Math.round(dist(l) / 5 * 60));
const dirURL = l => 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(l.address) + '&travelmode=walking' + (me ? `&origin=${me.lat},${me.lng}` : '');

function toast(msg, type = 'ok') {
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.innerHTML = (type === 'ok' ? IC('check-circle', 20) : IC('alert-circle', 20)) + '<span>' + esc(msg) + '</span>';
  $('#toasts').appendChild(t); icons();
  setTimeout(() => t.remove(), 3100);
}
function countUp(el) {
  const n = +el.dataset.count, reduce = matchMedia('(prefers-reduced-motion:reduce)').matches;
  if (reduce || n === 0) { el.textContent = n.toLocaleString(); return; }
  const t0 = performance.now();
  (function f(t) { const p = Math.min(1, (t - t0) / 1100); el.textContent = Math.round(n * (1 - (1 - p) ** 3)).toLocaleString(); if (p < 1) requestAnimationFrame(f); })(t0);
}

/* ---------- Impact ---------- */
function impact() {
  const sv = S.done.reduce((a, x) => a + x.servings, 0);
  return { count: S.done.length, servings: sv, kg: Math.round(sv * KG_PER_SERVING), orgs: S.orgs.filter(o => o.status === 'verified').length,
           sample: S.done.filter(x => x.sample).length };
}
const statsHTML = i => [
  ['Donations completed', i.count], ['Estimated servings redistributed', i.servings],
  ['Estimated food weight (kg)', i.kg], ['Verified organisations', i.orgs]
].map(([l, n]) => `<div class="stat"><b data-count="${n}">0</b><span>${l}</span></div>`).join('');

/* ---------- Cards ---------- */
function cardHTML(l) {
  const st = eff(l), v = isVerified(l.org);
  return `<article class="card"><div class="card-img" aria-hidden="true">${CATS[l.cat] || '🍱'}</div><div class="card-body">
    <div class="badges">
      <span class="badge"><span class="vd ${l.diet}"></span>${l.diet === 'veg' ? 'Veg' : 'Non-veg'}</span>
      ${l.allergens ? `<span class="badge allergen">${IC('alert-triangle')}Contains: ${esc(l.allergens)}</span>` : ''}
      <span class="badge ${stCls(st)}">${ST[st]}</span>
    </div>
    <h3>${esc(l.title)}</h3>
    <p class="meta">${esc(l.org)} ${v ? `<span class="badge verified">${IC('shield-check')}Verified</span>` : ''}</p>
    <div class="fresh ${soon(l) ? 'soon' : ''}">${IC('clock', 18)}<span>${freshText(l)}</span></div>
    <p class="meta">About ${l.servings} servings • ${dist(l).toFixed(1)} km away${me ? '' : ' (from demo start)'}</p>
    <button class="btn btn-primary" data-open="${l.id}">View details</button>
  </div></article>`;
}

/* ---------- Router ---------- */
const menuWrap = $('#menuWrap'), menuBtn = $('#menuBtn');
const renderers = {};
function route() {
  let r = (location.hash || '#home').slice(1);
  let v = $('#view-' + r);
  if (!v) { v = $('#view-404'); r = '404'; }
  $$('.view').forEach(x => x.hidden = x !== v);
  document.title = v.dataset.title;
  $$('.menu a').forEach(a => a.classList.toggle('active', a.dataset.route === r));
  menuWrap.classList.remove('open'); menuBtn.setAttribute('aria-expanded', 'false');
  window.scrollTo(0, 0);
  if (renderers[r]) renderers[r]();
  icons();
}
window.addEventListener('hashchange', route);

/* ---------- Home ---------- */
const LOOP = [
  ['Food donor', 'A canteen, restaurant or event team has safe food left over and lists it with a collect-by time.'],
  ['FoodLoop', 'The listing appears on the map and list with diet, allergen and freshness details.'],
  ['Verified recipient', 'An NGO or community kitchen finds a nearby match and slides to claim it.'],
  ['Pickup', 'The recipient gets directions, a pickup code and the coordinator’s phone number.'],
  ['Redistribution', 'The recipient confirms collection and the servings are counted in the impact page.']
];
function setLoop(i) {
  $$('#loopStages button').forEach((b, j) => b.setAttribute('aria-selected', j === i));
  $('#loopCard').innerHTML = `<h3>${LOOP[i][0]}</h3><p>${LOOP[i][1]}</p><p><small>Stop ${i + 1} of ${LOOP.length}. After the last stop the loop starts again.</small></p>`;
}
renderers.home = () => {
  if (!$('#loopStages').children.length) {
    $('#loopStages').innerHTML = LOOP.map((s, i) => `<button role="tab" type="button" data-loop="${i}">${s[0]}</button>`).join('');
    $$('#loopStages button').forEach((b, i) => { b.onclick = b.onmouseenter = () => setLoop(i); });
    setLoop(0);
  }
  const live = S.listings.filter(l => eff(l) === 'available').sort((a, b) => new Date(a.deadline) - new Date(b.deadline)).slice(0, 5);
  $('#previewTrack').innerHTML = live.map(cardHTML).join('') || '<div class="empty">No food listed right now.</div>';
  $('#homeStats').innerHTML = statsHTML(impact());
  $$('#homeStats [data-count]').forEach(countUp);
};

/* ---------- How ---------- */
renderers.how = () => {
  const steps = [['clipboard-list','List surplus food','A donor adds the food, servings, diet type, allergens and the time it must be collected by.'],
    ['search','Discover a match','Anyone can browse the map and list without an account. Filters narrow by food type, diet and distance.'],
    ['route','Coordinate pickup','Slide to claim, open directions in Google Maps, and call or message the coordinator for gate entry.'],
    ['party-popper','Confirm redistribution','After collecting, the recipient confirms. The servings are added to the impact page.']];
  $('#howList').innerHTML = steps.map((s, i) => `<div><h3>${IC(s[0], 28)} Step ${i + 1}: ${s[1]}</h3><p>${s[2]}</p></div>`).join('');
};

/* ---------- Impact page ---------- */
renderers.impact = () => {
  const i = impact();
  $('#impactStats').innerHTML = statsHTML(i); $$('#impactStats [data-count]').forEach(countUp);
  $('#dataFlag').textContent = i.sample ? `${i.sample} of ${i.count} completed donations are sample data. Real pickups you complete are added to the totals.` : 'All figures come from pickups completed in this browser.';
  const by = {}; S.done.forEach(d => by[d.cat] = (by[d.cat] || 0) + d.servings);
  const max = Math.max(1, ...Object.values(by));
  $('#impactBars').innerHTML = Object.keys(by).length ? Object.entries(by).map(([c, n]) =>
    `<div class="bar"><span>${c}</span><i style="width:${n / max * 100}%"></i><b>${n}</b></div>`).join('') : '<div class="empty">No completed pickups yet.</div>';
  $('#impactTimeline').innerHTML = S.done.slice(0, 8).map(d =>
    `<li><strong>${esc(d.title)}</strong> – ${d.servings} servings (${d.cat})${d.sample ? ' <span class="badge">Sample</span>' : ''}<br><small>${new Date(d.at).toLocaleString()}</small></li>`).join('');
};

/* ---------- Discover ---------- */
const F = { diet: '', avail: false };
let map, layer, routeLine, firstDiscover = true;
function initMap() {
  if (map) return;
  if (!window.L) { $('#map').innerHTML = '<div class="empty">The map could not load. Check your internet connection. The list still works.</div>'; return; }
  map = L.map('map', { scrollWheelZoom: false }).setView([ORIGIN.lat, ORIGIN.lng], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(map);
  layer = L.layerGroup().addTo(map);
}
function drawMap(list) {
  if (!map) return;
  layer.clearLayers(); routeLine = null;
  const o = origin();
  L.marker([o.lat, o.lng], { icon: L.divIcon({ className: '', html: '<div class="you-pin">You are here</div>', iconSize: [112, 30], iconAnchor: [56, 15] }), zIndexOffset: 1000 }).addTo(layer);
  const pts = [[o.lat, o.lng]];
  list.forEach(l => {
    const icon = L.divIcon({ className: '', iconSize: [46, 46], iconAnchor: [23, 23],
      html: `<div style="font-size:26px;background:#fff;border:3px solid #183D32;border-radius:50%;width:46px;height:46px;display:grid;place-items:center;box-shadow:0 4px 10px rgba(0,0,0,.25)">${CATS[l.cat] || '🍱'}</div>` });
    const m = L.marker([l.lat, l.lng], { icon, title: l.title }).addTo(layer);
    m.bindPopup(`<strong>${esc(l.title)}</strong><br>${esc(l.org)}<br>${dist(l).toFixed(1)} km • about ${walkMins(l)} min walk<br>
      <button class="btn btn-primary" style="min-height:44px;margin-top:8px;width:100%" data-dir="${l.id}">Get Directions</button>
      <button class="btn btn-ghost" style="min-height:44px;margin-top:6px;width:100%" data-open="${l.id}">View details</button>`);
    m.on('click', () => {
      if (routeLine) layer.removeLayer(routeLine);
      routeLine = L.polyline([[o.lat, o.lng], [l.lat, l.lng]], { color: '#A5502E', weight: 4, dashArray: '8 10' }).addTo(layer);
      map.fitBounds(routeLine.getBounds(), { padding: [60, 60] });
    });
    pts.push([l.lat, l.lng]);
  });
  if (pts.length > 1) map.fitBounds(pts, { padding: [40, 40] });
}
function filtered() {
  const q = $('#fSearch').value.trim().toLowerCase(), cat = $('#fCategory').value, sort = $('#fSort').value, maxD = +$('#fDist').value;
  let a = S.listings.filter(l => !['completed', 'cancelled'].includes(l.status));
  if (q) a = a.filter(l => (l.title + ' ' + l.desc + ' ' + l.org).toLowerCase().includes(q));
  if (cat) a = a.filter(l => l.cat === cat);
  if (F.diet) a = a.filter(l => l.diet === F.diet);
  if (F.avail) a = a.filter(l => eff(l) === 'available');
  if (maxD) a = a.filter(l => dist(l) <= maxD);
  if (sort === 'distance') a.sort((x, y) => dist(x) - dist(y));
  else if (sort === 'quantity') a.sort((x, y) => y.servings - x.servings);
  else a.sort((x, y) => new Date(x.deadline) - new Date(y.deadline));
  return a;
}
function drawList() {
  const a = filtered();
  $('#listState').innerHTML = a.length ? `<p><strong>${a.length}</strong> listing${a.length === 1 ? '' : 's'} found</p>` :
    '<div class="empty"><h3>No food matches these filters</h3><p>Try a wider distance or clear the search.</p></div>';
  $('#listGrid').innerHTML = a.map(cardHTML).join('');
  drawMap(a); icons();
}
renderers.discover = () => {
  initMap();
  if (map) setTimeout(() => map.invalidateSize(), 60);
  if (firstDiscover) {
    firstDiscover = false;
    $('#listGrid').innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
    setTimeout(drawList, 350);
  } else drawList();
};
function locate() {
  if (!navigator.geolocation) return toast('Your browser cannot share location.', 'err');
  navigator.geolocation.getCurrentPosition(p => {
    me = { lat: p.coords.latitude, lng: p.coords.longitude };
    $('#locNote').textContent = 'Distances now use your shared location. It stays in this browser.';
    $('#fSort').value = 'distance'; drawList(); updatePill(); toast('Location found.');
  }, () => toast('Could not get your location. Distances use the demo start point.', 'err'), { timeout: 8000 });
}

/* ---------- Drawer ---------- */
let lastFocus = null;
function openDrawer(id) {
  const l = byId(id); if (!l) return;
  lastFocus = document.activeElement;
  const st = eff(l), mine = S.my === l.id, v = isVerified(l.org);
  let action = '';
  if (st === 'available') action = `<div class="slider" id="claimSlider" data-id="${l.id}"><div class="slider-fill"></div><div class="slider-label">Slide to claim this food</div>
      <button class="slider-knob" type="button" aria-label="Slide right or press Enter to claim this food">${IC('chevrons-right', 24)}</button></div>`;
  else if (mine && st === 'pending') action = `<div class="fresh">${IC('hourglass', 18)}<span>Waiting for the donor to accept. Pickup code: <strong>${l.code}</strong></span></div>
      <p><small>Demo: open the <a href="#dash" data-close>Dashboards</a> page, choose “Food donor”, and accept the request.</small></p>`;
  else if (mine && st === 'accepted') action = `<div class="fresh">${IC('key-round', 18)}<span>Show this code at pickup: <strong>${l.code}</strong></span></div>
      <button class="btn btn-primary btn-lg" data-act="collect" data-id="${l.id}">I collected the food</button>`;
  else action = `<p><span class="badge ${stCls(st)}">${ST[st]}</span></p>`;
  $('#drawerBody').innerHTML = `
    <div class="card-img" style="border-radius:20px;margin-top:20px" aria-hidden="true">${CATS[l.cat] || '🍱'}</div>
    <div class="badges" style="margin-top:14px"><span class="badge"><span class="vd ${l.diet}"></span>${l.diet === 'veg' ? 'Vegetarian' : 'Non-vegetarian'}</span>
      ${l.allergens ? `<span class="badge allergen">${IC('alert-triangle')}Contains: ${esc(l.allergens)}</span>` : '<span class="badge">No allergens listed</span>'}
      <span class="badge ${stCls(st)}">${ST[st]}</span></div>
    <h2 id="drawerTitle" style="margin-top:14px">${esc(l.title)}</h2>
    <div class="fresh ${soon(l) ? 'soon' : ''}">${IC('clock', 18)}<span>${freshText(l)}</span></div>
    <p style="margin-top:12px">${esc(l.desc)}</p>
    <dl><dt>Donor</dt><dd>${esc(l.org)} ${v ? `<span class="badge verified">${IC('shield-check')}Verified</span>` : '<span class="badge">Not yet verified</span>'}</dd>
      <dt>Servings</dt><dd>About ${l.servings}</dd><dt>Pickup address</dt><dd>${esc(l.address)}</dd>
      <dt>Distance</dt><dd>${dist(l).toFixed(1)} km, about ${walkMins(l)} min walk${me ? '' : ' (from demo start)'}</dd>
      <dt>Handling</dt><dd>${esc(l.handling || 'None given')}</dd><dt>Pickup needs</dt><dd>Bring your own containers. Show your pickup code.</dd></dl>
    <button class="btn btn-primary btn-lg" data-dir="${l.id}">${IC('navigation', 20)}Get Directions in Google Maps</button>
    <div class="contact-row"><a class="btn btn-ghost" href="tel:${esc(l.phone)}">${IC('phone', 20)}Call coordinator</a>
      <a class="btn btn-ghost" href="sms:${esc(l.phone)}">${IC('message-circle', 20)}Message</a></div>
    ${action}
    <p style="margin-top:20px"><button class="btn btn-ghost" data-act="report" data-id="${l.id}" style="min-height:44px">${IC('flag', 18)}Report this listing</button></p>`;
  $('#drawer').hidden = false; document.body.style.overflow = 'hidden';
  icons(); $('#drawerPanel').focus();
  const s = $('#claimSlider'); if (s) slider(s, () => claim(l.id));
}
function closeDrawer() {
  if ($('#drawer').hidden) return;
  $('#drawer').hidden = true; document.body.style.overflow = '';
  if (lastFocus && lastFocus.focus) lastFocus.focus();
}
function slider(root, onDone) {
  const k = $('.slider-knob', root), f = $('.slider-fill', root);
  let dx = 0, drag = false;
  const max = () => root.clientWidth - k.offsetWidth - 8;
  const set = x => { k.style.transform = `translateX(${x}px)`; f.style.width = (x + k.offsetWidth) + 'px'; };
  const end = () => {
    if (!drag) return; drag = false;
    k.style.transition = 'transform .3s'; f.style.transition = 'width .3s';
    if (dx >= max() * .9) { set(max()); root.classList.add('done'); $('.slider-label', root).textContent = 'Claimed'; onDone(); }
    else { dx = 0; set(0); }
  };
  k.addEventListener('pointerdown', e => { drag = true; k.setPointerCapture(e.pointerId); k.style.transition = f.style.transition = 'none'; });
  k.addEventListener('pointermove', e => {
    if (!drag) return;
    dx = Math.max(0, Math.min(max(), e.clientX - root.getBoundingClientRect().left - k.offsetWidth / 2 - 4)); set(dx);
  });
  k.addEventListener('pointerup', end); k.addEventListener('pointercancel', end);
  k.addEventListener('keydown', e => { if (['Enter', 'ArrowRight', ' '].includes(e.key)) { e.preventDefault(); drag = true; dx = max(); end(); } });
}

/* ---------- Claim / status flow ---------- */
function claim(id) {
  const l = byId(id);
  if (!l || eff(l) !== 'available') return toast('Sorry, this food is no longer available.', 'err');
  if (S.my && byId(S.my) && ['pending', 'accepted'].includes(byId(S.my).status)) return toast('You already have an active pickup. Finish it first.', 'err');
  l.status = 'pending'; l.code = String(1000 + Math.floor(Math.random() * 9000));
  S.my = l.id; log(`Request sent for “${l.title}” (code ${l.code})`); save();
  toast('Food successfully claimed!'); updatePill(); setTimeout(() => { openDrawer(id); refresh(); }, 700);
}
function complete(id) {
  const l = byId(id); if (!l) return;
  l.status = 'completed';
  S.done.unshift({ title: l.title, cat: l.cat, servings: l.servings, at: new Date().toISOString(), sample: false });
  if (S.my === id) S.my = null;
  log(`Handover completed: “${l.title}”`); save(); updatePill(); closeDrawer(); refresh();
  celebrate(l);
}
function celebrate(l) {
  $('#celTitle').textContent = `You just fed ${l.servings} ${l.servings === 1 ? 'person' : 'people'} today.`;
  $('#celText').textContent = `“${l.title}” from ${l.org} found a destination instead of the bin. Thank you for closing the loop.`;
  const c = $('#celebrate'); c.hidden = true; void c.offsetWidth; c.hidden = false; $('#celClose').focus();
}
function updatePill() {
  const l = S.my && byId(S.my);
  if (!l || !['pending', 'accepted'].includes(l.status)) { $('#pill').hidden = true; return; }
  $('#pill').hidden = false;
  $('#pillTitle').textContent = l.status === 'accepted' ? `Walk to ${l.org} • ${walkMins(l)} min away` : `Request sent to ${l.org}`;
  $('#pillSub').textContent = l.status === 'accepted' ? `Show code: ${l.code}` : `Waiting for donor • Code ${l.code}`;
}
function refresh() {
  const r = (location.hash || '#home').slice(1);
  if (r === 'discover') drawList(); else if (r === 'dash') renderers.dash(); else if (r === 'home') renderers.home();
  icons();
}

/* ---------- Dashboards ---------- */
let tab = 'donor';
const table = (head, rows) => `<div class="table-wrap"><table><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
renderers.dash = () => {
  $$('.tab').forEach(t => { t.classList.toggle('on', t.dataset.tab === tab); t.setAttribute('aria-selected', t.dataset.tab === tab); });
  const b = $('#dashBody'), ls = S.listings;
  if (tab === 'donor') {
    const c = s => ls.filter(l => eff(l) === s).length;
    b.innerHTML = `<div class="stat-row">${[['Active listings', c('available')], ['Pending requests', c('pending')], ['Accepted', c('accepted')], ['Completed', c('completed')]]
      .map(([k, n]) => `<div class="stat"><b>${n}</b><span>${k}</span></div>`).join('')}</div>
      <div class="panel"><h2>Your listings</h2>${table(['Food', 'Status', 'Collect before', 'Actions'], ls.map(l => {
        const s = eff(l);
        const a = s === 'pending' ? `<button class="btn btn-primary" data-act="accept" data-id="${l.id}">Accept</button><button class="btn btn-ghost" data-act="decline" data-id="${l.id}">Decline</button>`
          : s === 'available' ? `<button class="btn btn-ghost" data-act="cancel" data-id="${l.id}">Cancel listing</button>`
          : s === 'accepted' ? 'Waiting for pickup' : '–';
        return `<tr><td><strong>${esc(l.title)}</strong><br><small>${esc(l.org)}</small></td><td><span class="badge ${stCls(s)}">${ST[s]}</span></td><td>${fmtT(l.deadline)}</td><td>${a}</td></tr>`;
      }).join(''))}<p><a class="btn btn-terra" href="#donate">Post a new listing</a></p></div>`;
  } else if (tab === 'recipient') {
    const my = S.my && byId(S.my);
    const rec = ls.filter(l => eff(l) === 'available').map(l => {
      const hrs = (new Date(l.deadline) - Date.now()) / 36e5;
      const score = Math.max(0, Math.min(100, Math.round(100 - dist(l) * 6 - (hrs < 1 ? 20 : 0) + (l.servings <= RECIPIENT_CAPACITY ? 10 : -15))));
      return { l, score };
    }).sort((a, b) => b.score - a.score).slice(0, 3);
    b.innerHTML = `<div class="panel"><h2>Your active pickup</h2>${my && ['pending', 'accepted'].includes(my.status)
      ? `<p><strong>${esc(my.title)}</strong> from ${esc(my.org)} <span class="badge ${stCls(my.status)}">${ST[my.status]}</span></p><p>Pickup code: <strong>${my.code}</strong></p>
         <button class="btn btn-primary" data-open="${my.id}">Open pickup details</button>`
      : '<div class="empty">No active pickup. <a href="#discover">Find food here</a></div>'}</div>
      <div class="panel"><h2>Recommended matches</h2><p><small>Match score is a simple rule: closer is better, soon-expiring food loses 20 points, and food above your capacity of ${RECIPIENT_CAPACITY} servings loses 15. This is not AI.</small></p>
      ${rec.map(r => `<p><strong>${esc(r.l.title)}</strong> – score ${r.score}/100 – ${dist(r.l).toFixed(1)} km – ${r.l.servings} servings <button class="btn btn-ghost" style="min-height:44px" data-open="${r.l.id}">View</button></p>`).join('') || '<div class="empty">Nothing available right now.</div>'}</div>
      <div class="panel"><h2>Collection history</h2>${S.done.slice(0, 6).map(d => `<p>${esc(d.title)} – ${d.servings} servings${d.sample ? ' <span class="badge">Sample</span>' : ''}</p>`).join('')}</div>`;
  } else {
    b.innerHTML = `<div class="panel"><h2>Organisation verification</h2><p><small>Demo only. Real admin rights must be enforced on a server.</small></p>${table(['Organisation', 'Type', 'Status', 'Actions'], S.orgs.map(o =>
      `<tr><td><strong>${esc(o.name)}</strong></td><td>${o.type}</td><td><span class="badge ${o.status === 'verified' ? 'status-available' : o.status === 'pending' ? 'status-pending' : 'status-bad'}">${o.status === 'verified' ? 'Verified' : o.status === 'pending' ? 'Pending review' : 'Rejected'}</span></td>
       <td>${o.status === 'pending' ? `<button class="btn btn-primary" data-act="approve" data-id="${o.id}">Approve</button><button class="btn btn-ghost" data-act="reject" data-id="${o.id}">Reject</button>` : '–'}</td></tr>`).join(''))}</div>
      <div class="panel"><h2>Activity record</h2><ul class="timeline">${S.log.slice(0, 8).map(e => `<li>${esc(e.m)}<br><small>${new Date(e.t).toLocaleString()}</small></li>`).join('')}</ul>
      <p><button class="btn btn-ghost" data-act="reset">Reset demo data</button></p></div>`;
  }
  icons();
};

/* ---------- Donate form ---------- */
let posting = false;
renderers.donate = () => {
  const sel = $('#dCategory');
  if (!sel.options.length) sel.innerHTML = '<option value="">Choose a category</option>' + Object.keys(CATS).map(c => `<option>${c}</option>`).join('');
};
async function geocode(addr) {
  try {
    const c = new AbortController(); setTimeout(() => c.abort(), 4000);
    const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(addr), { signal: c.signal });
    const j = await r.json();
    if (j[0]) return { lat: +j[0].lat, lng: +j[0].lon, exact: true };
  } catch (e) { /* fall through */ }
  return { lat: ORIGIN.lat + (Math.random() - .5) * .02, lng: ORIGIN.lng + (Math.random() - .5) * .02, exact: false };
}
function todayAt(hhmm) { const [h, m] = hhmm.split(':').map(Number), d = new Date(); d.setHours(h, m, 0, 0); return d; }
function validate() {
  const v = id => $('#' + id).value.trim(), e = {};
  if (v('dTitle').length < 3) e.dTitle = 'Enter the name of the food.';
  if (!v('dCategory')) e.dCategory = 'Choose a category.';
  const n = +v('dServings'); if (!(n >= 1 && n <= 2000)) e.dServings = 'Enter servings between 1 and 2000.';
  if (!v('dMade')) e.dMade = 'Enter the time it was made.';
  if (!v('dDeadline')) e.dDeadline = 'Enter the collect-before time.';
  if (v('dMade') && v('dDeadline')) {
    const made = todayAt(v('dMade')); let dl = todayAt(v('dDeadline'));
    if (dl <= made) dl = new Date(dl.getTime() + 864e5);
    if (dl <= new Date()) e.dDeadline = 'That time has already passed.';
  }
  if (v('dCategory') === 'Cooked Meals' && !v('dHandling')) e.dHandling = 'Cooked food needs a handling note, for example “keep hot”.';
  if (!v('dOrg')) e.dOrg = 'Enter your organisation name.';
  if (!/^\d{10}$/.test(v('dPhone').replace(/\s/g, ''))) e.dPhone = 'Enter a 10-digit phone number.';
  if (v('dAddress').length < 8) e.dAddress = 'Enter the full pickup address.';
  if (!$('#dSafe').checked) e.dSafe = 'Please confirm the food is safe to eat.';
  return e;
}
$('#donateForm').addEventListener('submit', async ev => {
  ev.preventDefault(); if (posting) return;
  const errs = validate();
  $$('.err', $('#donateForm')).forEach(x => { x.textContent = errs[x.dataset.for] || ''; const f = x.previousElementSibling; });
  $$('#donateForm .field').forEach(f => f.classList.toggle('invalid', !!$('input,select,textarea', f) && !!errs[$('input,select,textarea', f).id]));
  const first = Object.keys(errs)[0];
  if (first) { $('#' + first).focus(); return toast('Please fix the highlighted fields.', 'err'); }
  posting = true; const btn = $('#dSubmit'); btn.disabled = true; btn.textContent = 'Posting…';
  const v = id => $('#' + id).value.trim();
  const g = await geocode(v('dAddress'));
  const made = todayAt(v('dMade')); let dl = todayAt(v('dDeadline')); if (dl <= made) dl = new Date(dl.getTime() + 864e5);
  const l = { id: 'l' + Date.now(), title: v('dTitle'), cat: v('dCategory'), diet: $('input[name=dDiet]:checked').value, servings: +v('dServings'),
    allergens: v('dAllergens'), org: v('dOrg'), made: made.toISOString(), deadline: dl.toISOString(), lat: g.lat, lng: g.lng, address: v('dAddress'),
    handling: v('dHandling'), desc: v('dDesc') || 'No description given.', phone: v('dPhone').replace(/\s/g, ''), status: 'available', code: null, sample: false };
  S.listings.unshift(l); log(`New listing posted: “${l.title}” by ${l.org}`); save();
  posting = false; btn.disabled = false; btn.textContent = 'Post my listing';
  $('#donateForm').reset();
  toast('Listing posted! It is now live on the map.');
  if (!g.exact) setTimeout(() => toast('We could not find that address, so the pin is approximate.', 'err'), 600);
  location.hash = '#discover';
});

/* ---------- Global events ---------- */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-open],[data-dir],[data-act],[data-close]');
  if (!t) { if (!e.target.closest('#menuWrap')) menuWrap.classList.remove('open'); if (e.target.id === 'drawer') closeDrawer(); return; }
  if (t.dataset.close !== undefined) closeDrawer();
  if (t.dataset.open) openDrawer(t.dataset.open);
  if (t.dataset.dir) { const l = byId(t.dataset.dir); if (l) window.open(dirURL(l), '_blank', 'noopener'); }
  const a = t.dataset.act, id = t.dataset.id, l = id && byId(id);
  if (a === 'accept' && l) { l.status = 'accepted'; log(`Request accepted: “${l.title}”`); save(); updatePill(); toast('Request accepted. Pickup details shared.'); refresh(); }
  if (a === 'decline' && l) { l.status = 'available'; l.code = null; if (S.my === id) S.my = null; log(`Request declined: “${l.title}”`); save(); updatePill(); toast('Request declined. Listing is available again.'); refresh(); }
  if (a === 'cancel' && l && confirm(`Cancel the listing “${l.title}”? This cannot be undone.`)) { l.status = 'cancelled'; log(`Listing cancelled: “${l.title}”`); save(); toast('Listing cancelled.'); refresh(); }
  if (a === 'collect' && l) complete(id);
  if (a === 'report') toast('Thanks. The listing has been flagged for admin review (simulated).');
  if (a === 'approve' || a === 'reject') {
    const o = S.orgs.find(x => x.id === id);
    if (o) { o.status = a === 'approve' ? 'verified' : 'rejected'; log(`${o.name} ${o.status}`); save(); toast(`${o.name} ${a === 'approve' ? 'approved' : 'rejected'}.`); refresh(); }
  }
  if (a === 'reset' && confirm('Reset all demo data in this browser?')) { localStorage.removeItem(KEY); location.reload(); }
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  closeDrawer(); $('#celebrate').hidden = true; menuWrap.classList.remove('open'); menuBtn.setAttribute('aria-expanded', 'false');
});
menuBtn.addEventListener('click', () => {
  if (matchMedia('(hover:none)').matches) { const o = menuWrap.classList.toggle('open'); menuBtn.setAttribute('aria-expanded', o); }
});
menuWrap.addEventListener('mouseenter', () => menuBtn.setAttribute('aria-expanded', 'true'));
menuWrap.addEventListener('mouseleave', () => menuBtn.setAttribute('aria-expanded', 'false'));
$('#drawerClose').onclick = closeDrawer;
$('#celClose').onclick = () => { $('#celebrate').hidden = true; };
$('#pillAction').onclick = () => S.my && openDrawer(S.my);
$('#locateBtn').onclick = locate;
['fSearch', 'fCategory', 'fSort', 'fDist'].forEach(id => $('#' + id).addEventListener('input', drawList));
$$('#fDiet .chip').forEach(c => c.addEventListener('click', () => {
  if (c.dataset.avail) { F.avail = !F.avail; c.classList.toggle('on', F.avail); }
  else { F.diet = c.dataset.diet; $$('#fDiet [data-diet]').forEach(x => x.classList.toggle('on', x === c)); }
  drawList();
}));
$$('.tab').forEach(t => t.addEventListener('click', () => { tab = t.dataset.tab; renderers.dash(); }));

/* Hero parallax (desktop, motion allowed) */
const hero = $('#heroArt');
if (hero && matchMedia('(hover:hover)').matches && !matchMedia('(prefers-reduced-motion:reduce)').matches) {
  hero.addEventListener('mousemove', e => {
    const r = hero.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
    $$('[data-depth]', hero).forEach(g => { const d = +g.dataset.depth * 10; g.style.transform = `translate(${-x * d}px,${-y * d}px)`; });
  });
  hero.addEventListener('mouseleave', () => $$('[data-depth]', hero).forEach(g => g.style.transform = ''));
}

/* Init */
$('#fCategory').innerHTML = '<option value="">All food</option>' + Object.keys(CATS).map(c => `<option>${c}</option>`).join('');
updatePill();
route();
})();
