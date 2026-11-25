'use strict';

const $ = selector => document.querySelector(selector);
const names = value => value.split('·').map(part => part.trim()).filter(Boolean);
const key = 'seom-mountain-log:v1';
const goal = 100;
const categories = {
  personal: '개인 산행',
  'club-hike': '오르내림 산행',
  backpacking: '오르내림 백패킹',
  food: '오르내림 먹벙',
  play: '오르내림 놀이벙',
  'club-other': '오르내림 기타'
};
const certificationTypes = {classic:'100대 명산',plus:'100플러스 명산',island:'섬앤산',undecided:'미정'};
const certificationTypeOf = record => record.certificationType || 'island';
const categoryOf = record => record.category || 'personal';
const menus = {
  all: {label:'전체', categories:Object.keys(categories)},
  hike: {label:'산행', categories:['personal','club-hike','backpacking']},
  food: {label:'먹벙', categories:['food']},
  play: {label:'놀이벙', categories:['play','club-other']}
};
const isHike = category => menus.hike.categories.includes(category);
const defaultGear = ['등산화', '식수', '보조배터리'].map(label => ({label, checked:false}));
const blank = () => ({
  category:'personal', name:'', region:'', start:'', end:'', type:'', overnight:'', lodging:'', people:'',
  transport:'', budget:'', status:'planned', memo:'', notice:'', certified:[],
  gear:structuredClone(defaultGear)
});
let records = [];
let readError = false;
try {
  const saved = localStorage.getItem(key);
  if (saved) records = JSON.parse(saved);
} catch {
  readError = true;
}

const localRecords = () => {
  const saved = JSON.parse(localStorage.getItem(key) || '[]');
  if (!Array.isArray(saved)) throw new Error('Invalid local schedules');
  return saved;
};
let sync;
let account = null;
let stopSchedules;
let cloudReady = false;
let pendingOperation = false;

const form = $('#form');
const dialog = $('#editor');
const field = name => form.elements.namedItem(name);
const allFields = ['category','certificationType','name','region','start','end','type','host','people','lodging','overnight','transport','budget','status','memo','notice',
  'trailhead','waypoints','summit','trailEnd','routeType','distance','estimatedTime','difficulty',
  'meetingTime','meetingPlace','mapUrl','parking','vehiclePickup','campsite','campBooking','waterSource',
  'actualTime','actualRoute','hikeNotes','peakNames','plannedAscent','actualDistance','actualAscent',
  'facilityNotes','parkingNotes','junctionNotes','returnNotes'];
const readScheduleFields = () => Object.fromEntries(allFields.filter(name => field(name)).map(name => [name,field(name).value.trim()]));
const certificationPoints = record => [...new Set(names(record.peakNames?.trim() || record.name))];
const hikingMetrics = record => [record.routeType, record.distance && record.distance+'km', record.estimatedTime, record.difficulty && '난이도 '+record.difficulty].filter(Boolean).join(' · ');
let hikePhoto = '';
let photoRequest = 0;
let photoLoading = false;
const fmt = date => date ? date.replaceAll('-', '.') : '날짜 미정';
const iso = (year, month, day) => [year,String(month+1).padStart(2,'0'),String(day).padStart(2,'0')].join('-');
const today = new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date());
let month = new Date(today.slice(0,7)+'-01T00:00:00');
let selectedDay = '';
let view = 'planned';
let menu = 'all';
let showingHikeFeed = false;
const hasHikePhoto = record => /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(record.hikePhoto || '');
const crewMascots = ['glasses', 'hike', 'picnic', 'grill', 'ribbon', 'snack'];
const crewMascotIndex = {hike:5, food:1, play:3};
let editing;
let checks;
let gear;
let toastTimer;

function escape(value) {
  return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function feedback(message) {
  $('#toast').textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('#toast').textContent = '', 3200);
}

function isCompletedCertification(record) {
  const type = certificationTypeOf(record);
  return record.status === 'done' && isHike(categoryOf(record)) &&
    type !== 'undecided' && Object.hasOwn(certificationTypes, type) && Boolean(record.certified?.length);
}

const bacProgramLabels = {classic:'명산100', plus:'명산100+', island:'섬&산'};
const bacKey = value => value.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}+]/gu, '');
const bacCatalog = Object.entries(JSON.parse($('#bac-catalog')?.textContent || '{}')).flatMap(([type, rows]) =>
  rows.map(([name, summit, altitude, region]) => {
    const baseName = name.replace(/\s*\([^)]*\)/g, '');
    const pointName = summit.replace(/\s*(정상석|인증석|표지판)$/, '');
    const hasSpecificPoint = pointName && !/^(정상|이정목|인증지|인증점)$|[,/()]/.test(pointName) &&
      !bacKey(name).includes(bacKey(pointName));
    const label = hasSpecificPoint ? name + ' ' + pointName : name;
    const plainSummit = summit.split('(')[0].replace(/\s*(정상석|인증석|표지판)$/, '').trim();
    const summitAlias = plainSummit && !/^(정상|이정목|인증지|인증점)$|[,/]/.test(plainSummit) ? [plainSummit, baseName + plainSummit] : [];
    const aliases = new Set([name, label, baseName, baseName + summit, baseName + pointName, ...summitAlias].map(bacKey));
    return {id:`${type}:${name}`, type, name, label, summit, altitude, region, aliases,
      search:bacKey([name, summit, altitude, region, bacProgramLabels[type], certificationTypes[type]].join(' '))};
  }));
const bacById = new Map(bacCatalog.map(place => [place.id, place]));
let bacLinks = [];

function scheduleBacLinks(links, type, points) {
  if (!Array.isArray(links)) return [];
  return links.filter(link => typeof link?.id === 'string' && link.id.startsWith(type+':') && points.includes(link.point));
}

function bacRegionMatches(place, region) {
  const normalized = bacKey(region).replace(/(특별시|광역시|특별자치도|도|시|군)$/u, '');
  return !normalized || bacKey(place.region).includes(normalized);
}

function legacyBacMatch(type, name, region) {
  const candidates = bacCatalog.filter(place => place.type === type && place.aliases.has(bacKey(name)));
  const exact = candidates.find(place => bacKey(name) === bacKey(place.name) && /\(/.test(place.name));
  if (exact) return exact.id;
  const matches = candidates.filter(place => bacRegionMatches(place, region));
  return matches.length === 1 ? matches[0].id : '';
}

function renderBacLinks() {
  const list = $('#bac-connected');
  if (!list) return;
  const type = field('certificationType').value;
  const points = certificationPoints({name:field('name').value, peakNames:field('peakNames').value});
  const links = scheduleBacLinks(bacLinks, type, points);
  list.innerHTML = links.map(({id, point}) => {
    const place = bacById.get(id);
    const label = place ? `${place.label} · ${place.region}` : point;
    return `<li><span>${escape(label)}</span><button type="button" data-bac-unlink="${escape(id)}" aria-label="${escape(place?.name || point)} 연결 해제">연결 해제</button></li>`;
  }).join('');
  list.hidden = !links.length;
}

function renderBacSearch() {
  const query = $('#bac-search').value.trim().split(/\s+/).map(bacKey).filter(Boolean);
  const results = $('#bac-results');
  const status = $('#bac-status');
  results.replaceChildren();
  if (!query.length) {
    status.textContent = '';
    return;
  }
  const matches = bacCatalog.filter(place => query.every(term => place.search.includes(term)));
  status.textContent = !matches.length ? '검색 결과가 없어요. 산 이름이나 지역을 확인해 주세요.' :
    matches.length > 12 ? `${matches.length}곳 중 12곳을 표시해요. 지역이나 봉우리 이름을 더 입력해 보세요.` : `${matches.length}곳을 찾았어요.`;
  results.innerHTML = matches.slice(0, 12).map(place => `<li><button type="button" data-bac-place="${escape(place.id)}">
    <strong>${escape(place.name)}</strong><small>${escape([bacProgramLabels[place.type], place.summit, place.altitude, place.region].join(' · '))}</small>
  </button></li>`).join('');
}

function selectBacPlace(id) {
  const place = bacById.get(id);
  if (!place) return;
  const type = field('certificationType');
  const pointsField = field('peakNames');
  const title = field('name');
  const existingPoints = certificationPoints({name:title.value, peakNames:pointsField.value});
  const checkedPoints = existingPoints.filter(point => checks.has(point));
  if (place.type !== type.value && (checkedPoints.length || scheduleBacLinks(bacLinks, type.value, existingPoints).length)) {
    $('#bac-status').textContent = '이 일정에는 다른 유형의 인증 기록이 있어요. 같은 유형의 인증지를 선택해 주세요.';
    return;
  }
  const points = pointsField.value.trim() ? existingPoints : checkedPoints;
  const previous = scheduleBacLinks(bacLinks, place.type, points);
  const existing = previous.find(link => link.id === id);
  const available = points.find(point => place.aliases.has(bacKey(point)) && !previous.some(link => link.point === point));
  const point = existing?.point || available || place.label;
  const text = [...new Set([...points, point])].join(' · ');
  if (text.length > pointsField.maxLength) {
    $('#bac-status').textContent = '한 일정에 연결할 수 있는 인증 포인트 길이를 초과했어요.';
    return;
  }
  if (!title.value.trim()) {
    title.value = place.name;
    title.setCustomValidity('');
  }
  type.value = place.type;
  pointsField.value = text;
  bacLinks = existing ? previous : [...previous, {id, point}];
  renderPeaks();
  const search = $('#bac-search');
  search.value = '';
  renderBacSearch();
  $('#bac-status').textContent = `${place.name} 인증지를 연결했어요.`;
  search.focus();
}

function initBacPicker() {
  $('#bac-search').oninput = renderBacSearch;
  $('#bac-search').onkeydown = event => {
    if (event.key === 'Enter' && !event.isComposing) event.preventDefault();
  };
  $('#bac-results').onclick = event => {
    const id = event.target.closest('button')?.dataset.bacPlace;
    if (id) selectBacPlace(id);
  };
  $('#bac-connected').onclick = event => {
    const id = event.target.closest('button')?.dataset.bacUnlink;
    if (!id) return;
    bacLinks = bacLinks.filter(link => link.id !== id);
    renderBacLinks();
    $('#bac-status').textContent = 'BAC 인증지 연결을 해제했어요. 입력한 인증 포인트는 남겨뒀어요.';
    $('#bac-search').focus();
  };
  field('certificationType').onchange = renderBacLinks;
}

function countCertifiedPeaks(type) {
  const regionsByPeak = new Map();
  const linkedIds = new Set();
  for (const record of records) {
    if (!isCompletedCertification(record) || certificationTypeOf(record) !== type) continue;
    const region = (record.region || '').normalize('NFC').trim().replace(/\s+/g, ' ');
    const links = scheduleBacLinks(record.bacLinks, type, record.certified);
    for (const peak of record.certified) {
      const linked = links.find(link => link.point === peak);
      if (linked) {
        linkedIds.add(linked.id);
        continue;
      }
      const name = peak.normalize('NFC').trim();
      if (!name) continue;
      if (!regionsByPeak.has(name)) regionsByPeak.set(name, new Set());
      if (region) regionsByPeak.get(name).add(region);
    }
  }
  let count = linkedIds.size;
  for (const [name, regions] of regionsByPeak) {
    for (const region of regions.size ? regions : ['']) {
      if (!linkedIds.size || !linkedIds.has(legacyBacMatch(type, name, region))) count++;
    }
  }
  return count;
}

function renderHikeOverview() {
  const overview = $('#hike-overview');
  if (!overview) return;
  const record = readScheduleFields();
  overview.hidden = !isHike(record.category);
  if (overview.hidden) return;
  const done = record.status === 'done';
  $('#hike-overview-name').textContent = record.name || '산행 요약';
  $('#hike-overview-status').textContent = done ? '완료' : '예정';
  const certification = record.certificationType === 'undecided' ? '미정' :
    [certificationTypes[record.certificationType], certificationPoints(record).join(' · ')].filter(Boolean).join(' · ');
  const rows = [
    ['날짜', scheduleDate(record, true)],
    ['집결', [record.meetingTime, record.meetingPlace].filter(Boolean).join(' · ')],
    ['들머리', record.trailhead],
    ['거리·예상 시간', [record.distance && record.distance+' km', record.estimatedTime].filter(Boolean).join(' · ')],
    ['인증', certification]
  ];
  $('#hike-overview-data').innerHTML = rows.filter(([, value]) => value).map(([label, value]) =>
    '<div><dt>'+escape(label)+'</dt><dd>'+escape(value)+'</dd></div>').join('');
  const map = $('#hike-overview-map');
  const url = mapLink(record.mapUrl);
  map.hidden = !url;
  if (url) map.href = url;
  else map.removeAttribute('href');
  for (const action of overview.querySelectorAll('[data-hike-jump]')) {
    action.hidden = (action.dataset.hikePhase && action.dataset.hikePhase !== record.status) ||
      (action.dataset.hikeJump === 'hike-location' && !editing.id);
  }
}

function layoutScheduleSections(reset = false) {
  const container = $('#editor-sections');
  if (!container) return;
  const hike = isHike(field('category').value);
  const done = field('status').value === 'done';
  const priority = !hike ? ['schedule-basic','schedule-gear','schedule-notice'] : done ?
    ['editor-certification','hike-media','hike-log','schedule-basic','hike-location','hike-planning','schedule-gear','schedule-notice'] :
    ['schedule-basic','hike-planning','schedule-gear','schedule-notice','hike-location','editor-certification','hike-media','hike-log'];
  const active = document.activeElement;
  if (reset || container.dataset.layout !== priority.join(' ')) {
    for (const id of priority) container.insertBefore(document.getElementById(id), $('#schedule-details'));

    container.dataset.layout = priority.join(' ');
    if (active && container.contains(active)) active.focus({preventScroll:true});
  }
  if (reset) {
    for (const section of container.children) section.open = false;
    $('#schedule-basic').open = !hike || !editing.id;
    $('#editor-certification').open = hike && done;
    $('#certification-edit').open = !done;
  }
  $('#editor-certification').hidden = !hike;
}

function revealScheduleSection(id) {
  const section = document.getElementById(id);
  if (!section || section.hidden) return;
  section.open = true;
  section.querySelector('summary').focus({preventScroll:true});
  section.scrollIntoView({block:'start'});
}

function bacScheduleIndex() {
  const index = new Map();
  for (const record of records) {
    if (!isHike(categoryOf(record))) continue;
    const type = certificationTypeOf(record);
    if (!Object.hasOwn(bacProgramLabels, type)) continue;
    const complete = isCompletedCertification(record);
    if (!complete && record.status !== 'planned') continue;
    const points = complete ? record.certified : certificationPoints(record);
    const links = scheduleBacLinks(record.bacLinks, type, points);
    for (const point of points) {
      const explicit = links.find(link => link.point === point);
      const id = explicit?.id || legacyBacMatch(type, point, record.region || '');
      if (!id) continue;
      const current = index.get(id);
      if (!current || (complete && current.status !== 'done')) {
        index.set(id, {status:complete ? 'done' : 'planned', record});
      }
    }
  }
  return index;
}

const bacListLabels = {done:'완료', planned:'예정', unvisited:'미방문'};
const bacPageSize = 12;
let bacListLimit = bacPageSize;

function renderBacProgress() {
  const panel = $('#bac-progress');
  if (!panel?.open) return;
  const list = $('#bac-progress-list');
  const message = $('#bac-progress-count');
  const more = $('#bac-progress-more');
  if ((account && !cloudReady) || (!account && readError)) {
    list.replaceChildren();
    more.hidden = true;
    message.textContent = account ? $('#sync-status').textContent : '저장된 일정을 불러올 수 없어요.';
    return;
  }
  const type = $('#bac-progress-type').value;
  const filter = $('#bac-progress-status').value;
  const terms = $('#bac-progress-search').value.trim().split(/\s+/).map(bacKey).filter(Boolean);
  const schedules = bacScheduleIndex();
  const entries = bacCatalog.filter(place => place.type === type && terms.every(term => place.search.includes(term)))
    .map(place => ({place, ...schedules.get(place.id)}));
  const matching = entries.filter(entry => (entry.status || 'unvisited') === filter);
  message.textContent = matching.length ? bacListLabels[filter]+' '+matching.length+'곳' : '조건에 맞는 인증지가 없어요.';
  list.innerHTML = matching.slice(0, bacListLimit).map(({place, record}) => {
    const details = [place.summit, place.altitude, place.region, record?.start && scheduleDate(record, true)].filter(Boolean).join(' · ');
    const button = record ? '<button type="button" data-record="'+escape(record.id)+'" aria-label="'+escape(place.name)+' 일정 보기">일정 보기</button>' :
      '<button type="button" data-bac-plan="'+escape(place.id)+'" aria-label="'+escape(place.name)+' 일정 만들기">일정 만들기</button>';
    return '<li><div><strong>'+escape(place.name)+'</strong><small>'+escape(details)+'</small></div>'+button+'</li>';
  }).join('');
  more.hidden = matching.length <= bacListLimit;
}

function initBacProgress() {
  const panel = $('#bac-progress');
  panel.ontoggle = renderBacProgress;
  panel.oninput = () => {
    bacListLimit = bacPageSize;
    renderBacProgress();
  };
  $('#bac-progress-more').onclick = () => {
    const firstNew = bacListLimit;
    bacListLimit += bacPageSize;
    renderBacProgress();
    $('#bac-progress-list').children[firstNew]?.querySelector('button')?.focus();
  };
  $('#bac-progress-list').onclick = event => {
    const id = event.target.closest('button')?.dataset.bacPlan;
    const place = bacById.get(id);
    if (!place) return;
    openEditor({...blank(), name:place.name, region:place.region, certificationType:place.type,
      peakNames:place.label, bacLinks:[{id:place.id, point:place.label}]});
  };
}

function renderCertification() {
  const cards = $('#certification-cards');
  if (!cards) return;
  cards.innerHTML = ['classic','plus','island'].map(type => {
    const count = countCertifiedPeaks(type);
    const percent = Math.min(100, Math.round(count / goal * 100));
    return `<div class="certification-count${count >= goal ? ' is-complete' : ''}">
      <span class="certification-label">${certificationTypes[type]}${count >= goal ? '<span class="completion-badge">완등</span>' : ''}</span>
      <strong>${count}<small> / ${goal}좌</small></strong>
      <div class="bar" aria-hidden="true"><i style="width:${percent}%"></i></div></div>`;
  }).join('');
}

function render() {
  renderCertification();
  renderBacProgress();
  const active = menus[menu];
  document.body.dataset.theme = menu;
  document.querySelectorAll('[data-menu]').forEach(button => {
    button.setAttribute('aria-pressed', !showingHikeFeed && button.dataset.menu === menu);
  });
  $('#stats').hidden = showingHikeFeed || menu !== 'hike';
  const shortcut = $('#certification-shortcut');
  if (shortcut) shortcut.hidden = showingHikeFeed || menu !== 'all';
  const feed = $('#hike-feed');
  if (feed) {
    feed.hidden = !showingHikeFeed;
    $('#hike-feed-tab').setAttribute('aria-pressed', showingHikeFeed);
    $('.upcoming').hidden = $('.calendar-layout').hidden = showingHikeFeed;
    if (showingHikeFeed) {
      renderHikeFeed();
      return;
    }
    $('#hike-feed-cards').replaceChildren();
  }
  $('[data-view="certified"]').hidden = menu !== 'hike' && menu !== 'all';
  $('#record-heading').textContent = active.label + ' 일정';
  const categoryFilter = $('#category-filter');
  categoryFilter.hidden = active.categories.length === 1;
  categoryFilter.options[0].textContent = menu === 'hike' ? '모든 산행' : '모든 모임';
  for (const option of categoryFilter.options) {
    option.hidden = Boolean(option.value) && !active.categories.includes(option.value);
    option.disabled = option.hidden;
  }
  const certificationFilter = $('#certification-filter');
  certificationFilter.hidden = menu !== 'hike';
  renderUpcoming(active.categories);
  document.querySelectorAll('[data-view]').forEach(button => button.setAttribute('aria-pressed',button.dataset.view === view));
  const filter = $('#filter').value;
  const category = $('#category-filter').value;
  const list = (view === 'certified' ? records.filter(isCompletedCertification) :
    records.filter(record => record.status === view))
    .filter(record => (!filter || record.type === filter) && active.categories.includes(categoryOf(record)) && (!category || categoryOf(record) === category))
    .filter(record => menu !== 'hike' || !certificationFilter.value || certificationTypeOf(record) === certificationFilter.value)
    .sort((a,b) => a.start && b.start ? (view === 'planned' ? a.start.localeCompare(b.start) : b.start.localeCompare(a.start)) : Number(!a.start)-Number(!b.start));
  const recordsPanel = $('#records');
  const previewLimit = 5;
  const canExpand = menu === 'all' && list.length > previewLimit;
  const scope = JSON.stringify([view, filter, category]);
  const previous = $('#more-schedules');
  const expanded = previous?.dataset.scope === scope && previous.open;
  const shown = canExpand ? list.slice(0, previewLimit) : list;
  recordsPanel.innerHTML = shown.map(record => scheduleCard(record, view)).join('') || (view === 'planned' && !filter && !category && (menu !== 'hike' || !certificationFilter.value)
    ? '<div class="empty empty-planner"><img src="crew-ribbon.jpeg" alt="" width="76" height="76"><div><p>첫 벙을 열어볼까요?</p><button type="button" data-add-schedule>＋ 새 일정</button></div></div>'
    : '<p class="empty">표시할 기록이 없어요.</p>');
  if (canExpand) {
    const rest = list.slice(previewLimit);
    const expandLabel = '일정 '+rest.length+'개 더 보기';
    recordsPanel.insertAdjacentHTML('beforeend',
      `<details id="more-schedules"${expanded ? ' open' : ''}>
        <summary>${expanded ? '일정 접기' : expandLabel}</summary>
        ${rest.map(record => scheduleCard(record, view)).join('')}
      </details>`);
    const more = $('#more-schedules');
    more.dataset.scope = scope;
    more.ontoggle = () => more.querySelector('summary').textContent = more.open ? '일정 접기' : expandLabel;
  }
  renderCalendar();
}

const calendarKindLabels = {hike:'산행',backpacking:'백패킹',food:'먹벙',play:'놀이벙'};
const calendarKind = record => {
  const category = categoryOf(record);
  if (category === 'backpacking' || category === 'food') return category;
  return isHike(category) ? 'hike' : 'play';
};
const calendarDot = kind => `<i class="calendar-dot ${kind}" aria-hidden="true"></i>`;

const hikePinLabels = {trailhead:'들머리', summit:'정상', trailEnd:'날머리'};
let hikePins = {};
let hikeTrack = null;
let hikeRequest = 0;
let positionRequest = 0;
let hikeLoading = false;
let locatingHike = false;

function validHikePoint(point) {
  return Number.isFinite(point?.lat) && Math.abs(point.lat) <= 90 &&
    Number.isFinite(point.lon) && Math.abs(point.lon) <= 180;
}

function trackDistance(first, second) {
  const rad = Math.PI / 180;
  const a = Math.sin((second.lat - first.lat) * rad / 2) ** 2 +
    Math.cos(first.lat * rad) * Math.cos(second.lat * rad) * Math.sin((second.lon - first.lon) * rad / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(Math.min(1, a)));
}

function parseHikeTrack(text, filename) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('Unsupported GPX declaration');
  const root = new DOMParser().parseFromString(text, 'application/xml').documentElement;
  if (root.localName !== 'gpx') throw new Error('Invalid GPX');
  const children = (node, name) => Array.from(node.children).filter(child => child.localName === name);
  const readNumber = value => value?.trim() ? Number(value) : NaN;
  const tracks = children(root, 'trk').flatMap(track => children(track, 'trkseg').map(segment => children(segment, 'trkpt')));
  const routes = children(root, 'rte').map(route => children(route, 'rtept'));
  const pointGroups = tracks.some(group => group.length >= 2) ? tracks : routes;
  if (pointGroups.reduce((total, group) => total + group.length, 0) > 100000) throw new Error('GPX has too many points');
  const segments = pointGroups.map(group => group.map(node => {
    const elevation = readNumber(children(node, 'ele')[0]?.textContent);
    return {
      lat:readNumber(node.getAttribute('lat')), lon:readNumber(node.getAttribute('lon')),
      elevation:Math.abs(elevation) <= 12000 ? elevation : NaN,
      time:Date.parse(children(node, 'time')[0]?.textContent)
    };
  }).filter(validHikePoint)).filter(group => group.length >= 2);
  if (!segments.length || segments.length > 200) throw new Error('Unsupported GPX segments');

  let distance = 0, ascent = 0, elevationPairs = 0;
  let south = Infinity, north = -Infinity, west = Infinity, east = -Infinity;
  let low = Infinity, high = -Infinity;
  const origin = segments[0][0].lon;
  for (const segment of segments) {
    let previous;
    for (const point of segment) {
      if (previous) {
        distance += trackDistance(previous, point);
        if (Number.isFinite(point.elevation) && Number.isFinite(previous.elevation)) {
          elevationPairs++;
          ascent += Math.max(0, point.elevation - previous.elevation);
        }
      }
      point.distance = distance;
      point.x = origin + ((point.lon - origin + 540) % 360) - 180;
      west = Math.min(west, point.x);
      east = Math.max(east, point.x);
      south = Math.min(south, point.lat);
      north = Math.max(north, point.lat);
      if (Number.isFinite(point.elevation)) {
        low = Math.min(low, point.elevation);
        high = Math.max(high, point.elevation);
      }
      previous = point;
    }
  }
  const cosLat = Math.cos((south + north) * Math.PI / 360);
  const scale = Math.min(344 / (Math.max(east - west, 0.000001) * cosLat), 104 / Math.max(north - south, 0.000001));
  const xy = (x, y) => `${Math.round(x)},${Math.round(y)}`;
  const path = (groups, project) => groups.map(group => {
    const stride = Math.max(1, Math.ceil((group.length - 1) / Math.max(1, Math.floor(500 / groups.length))));
    return group.filter((_, i) => i % stride === 0 || i === group.length - 1)
      .map((point, i) => (i ? 'L' : 'M') + project(point)).join('');
  }).join('');
  const route = path(segments, point => xy(180 + (point.x - (west + east) / 2) * cosLat * scale,
    60 + ((south + north) / 2 - point.lat) * scale));
  const elevationGroups = [];
  for (const segment of segments) {
    let group = [];
    for (const point of segment) {
      if (Number.isFinite(point.elevation)) group.push(point);
      else if (group.length) {
        if (group.length > 1) elevationGroups.push(group);
        group = [];
      }
    }
    if (group.length > 1) elevationGroups.push(group);
  }
  const profile = distance ? path(elevationGroups.slice(0, 200), point =>
    xy(8 + point.distance * 344 / distance, high === low ? 60 : 112 - (point.elevation - low) * 104 / (high - low))) : '';
  const elapsed = segments[segments.length - 1].at(-1).time - segments[0][0].time;
  const completeElevation = elevationPairs === segments.reduce((count, segment) => count + segment.length - 1, 0);
  return {
    name:filename.slice(0, 150), route, profile, km:Math.round(distance / 10) / 100,
    ascent:completeElevation ? Math.round(ascent) : null,
    low:profile ? Math.round(low) : null, high:profile ? Math.round(high) : null,
    minutes:elapsed > 0 ? Math.max(1, Math.round(elapsed / 60000)) : null
  };
}

function validHikePath(path) {
  return typeof path === 'string' && path.length <= 16000 && /^(?:[ML]\d{1,3},\d{1,3})+$/.test(path);
}

function hikeHasTrack(track) {
  return validHikePath(track?.route) && Number.isFinite(track.km) && track.km >= 0;
}

function hikeChart(path, label, kind) {
  if (!validHikePath(path)) return '';
  return `<svg class="hike-chart hike-chart-${kind}" viewBox="0 0 360 120" role="img" aria-label="${label}"><path d="${path}" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function hikeTrackPreview(track) {
  if (!hikeHasTrack(track)) return '';
  const profile = hikeChart(track.profile, '거리별 고도 그래프', 'elevation');
  return `<span class="hike-track-preview">
    <span>GPX 경로 · ${track.km} km</span>${hikeChart(track.route, '이동 경로', 'route')}
    ${profile && `<span>고도 ${Number(track.low)}–${Number(track.high)} m · ${track.km} km</span>${profile}`}
  </span>`;
}

function hikeComparison(record) {
  const track = hikeHasTrack(record.hikeTrack) ? record.hikeTrack : null;
  const metric = (value, unit) => value != null && value !== '' ? `${value} ${unit}` : '';
  const minutes = track?.minutes;
  const duration = Number.isFinite(minutes) && minutes > 0 ?
    `${Math.floor(minutes / 60) ? Math.floor(minutes / 60) + '시간 ' : ''}${minutes % 60}분 (GPX 경과 시간)` : '';
  const rows = [
    ['거리', metric(record.distance, 'km'), metric(record.actualDistance || track?.km, 'km')],
    ['시간', record.estimatedTime, record.actualTime || duration],
    ['누적 상승', metric(record.plannedAscent, 'm'), metric(record.actualAscent || track?.ascent, 'm')]
  ];
  return `<table class="hike-comparison"><thead><tr><th scope="col">항목</th><th scope="col">계획</th><th scope="col">실제</th></tr></thead><tbody>${rows.map(([label, planned, actual]) =>
    `<tr><th scope="row">${label}</th><td>${escape(planned || '—')}</td><td>${escape(actual || '—')}</td></tr>`).join('')}</tbody></table>`;
}

function refreshHikeComparison() {
  $('#hike-comparison').innerHTML = hikeComparison({...readScheduleFields(), hikeTrack});
}

function renderHikeTrack(message = '') {
  $('#hike-track-preview').innerHTML = hikeTrackPreview(hikeTrack);
  $('#hike-track-file').textContent = hikeTrack?.name || '';
  $('#remove-hike-track').hidden = !hikeTrack;
  $('#hike-track-status').textContent = message;
  refreshHikeComparison();
}

async function loadHikeTrack(event) {
  const input = event.currentTarget;
  const file = input.files[0];
  input.value = '';
  if (!file) return;
  const request = ++hikeRequest;
  hikeLoading = true;
  $('#hike-track-status').textContent = 'GPX 불러오는 중…';
  try {
    if (file.size > 8 * 1024 * 1024) {
      $('#hike-track-status').textContent = '8 MB 이하의 GPX 파일을 선택해 주세요.';
      return;
    }
    const track = parseHikeTrack(await file.text(), file.name);
    if (request !== hikeRequest || !dialog.open) return;
    hikeTrack = track;
    renderHikeTrack('경로를 불러왔어요. 일정에서 저장하면 기록에 남아요.');
  } catch {
    if (request === hikeRequest && dialog.open) $('#hike-track-status').textContent = '경로를 읽지 못했어요. 이동 경로가 담긴 GPX 파일인지 확인해 주세요.';
  } finally {
    if (request === hikeRequest) hikeLoading = false;
  }
}

function renderHikePins() {
  $('#hike-pin-list').innerHTML = Object.entries(hikePinLabels).map(([id, label]) => {
    const point = hikePins[id];
    const saved = validHikePoint(point);
    const coords = saved ? `${point.lat.toFixed(5)}, ${point.lon.toFixed(5)}` : '';
    return `<div class="hike-pin"><strong>${label}</strong><div class="hike-pin-actions">
      <button type="button" data-locate-hike="${id}" ${locatingHike ? 'disabled' : ''}>${saved ? '현재 위치로 변경' : '현재 위치 저장'}<span class="hike-visually-hidden"> · ${label}</span></button>
      ${saved ? `<a href="https://www.google.com/maps/search/?api=1&amp;query=${encodeURIComponent(coords)}" target="_blank" rel="noopener noreferrer" aria-label="${label} 지도 열기">지도 열기</a>
      <button type="button" data-remove-hike-pin="${id}" aria-label="${label} 위치 지우기" ${locatingHike ? 'disabled' : ''}>지우기</button>` : ''}
    </div>${saved ? `<small>${coords}${Number.isFinite(point.accuracy) ? ` · 오차 약 ${Math.round(point.accuracy)} m` : ''}</small>` : ''}</div>`;
  }).join('');
}

function handleHikePin(event) {
  if (!editing.id || pendingOperation || locatingHike || !isHike(field('category').value)) return;
  const button = event.target.closest('button');
  if (!button) return;
  const status = $('#hike-pin-status');
  const remove = button.dataset.removeHikePin;
  if (remove) {
    delete hikePins[remove];
    renderHikePins();
    status.textContent = `${hikePinLabels[remove]} 위치를 지웠어요. 일정에서 저장하면 반영돼요.`;
    $('#hike-pin-list').querySelector(`[data-locate-hike="${remove}"]`).focus();
    return;
  }
  const id = button.dataset.locateHike;
  if (!id) return;
  if (!navigator.geolocation) {
    status.textContent = '이 브라우저에서는 현재 위치를 읽을 수 없어요.';
    return;
  }
  const request = ++positionRequest;
  locatingHike = true;
  renderHikePins();
  status.textContent = `${hikePinLabels[id]} 위치를 찾는 중…`;
  const finish = message => {
    locatingHike = false;
    renderHikePins();
    status.textContent = message;
    if (isHike(field('category').value)) $('#hike-pin-list').querySelector(`[data-locate-hike="${id}"]`).focus();
  };
  navigator.geolocation.getCurrentPosition(({coords}) => {
    if (request !== positionRequest || !dialog.open) return;
    const point = {lat:Number(coords.latitude.toFixed(5)), lon:Number(coords.longitude.toFixed(5)), accuracy:Math.round(coords.accuracy)};
    if (!validHikePoint(point) || !Number.isFinite(point.accuracy)) {
      finish('위치를 확인할 수 없어요. 잠시 뒤 다시 시도해 주세요.');
      return;
    }
    hikePins[id] = point;
    finish(`${hikePinLabels[id]} 위치를 찍었어요. 아래 저장 버튼을 누르면 일정에 남아요.`);
  }, error => {
    if (request !== positionRequest || !dialog.open) return;
    finish(error.code === 1 ? '위치 접근이 차단되어 있어요. 아이폰 또는 브라우저의 위치 권한을 확인해 주세요.' : '현재 위치를 찾지 못했어요. 잠시 뒤 다시 시도해 주세요.');
  }, {enableHighAccuracy:true, timeout:15000, maximumAge:0});
}

function renderHikeFeed() {
  const posts = account && cloudReady ? records.filter(record => record.status === 'done' &&
    isHike(categoryOf(record)) && (hasHikePhoto(record) || hikeHasTrack(record.hikeTrack))).sort((first, second) =>
      (second.start || '').localeCompare(first.start || '') || (second.end || '').localeCompare(first.end || '')) : [];
  const message = $('#hike-feed-message');
  message.hidden = posts.length > 0;
  message.textContent = !account ? 'Google 계정으로 로그인하면 내 산행 사진과 경로를 볼 수 있어요.' :
    !cloudReady ? $('#sync-status').textContent : '완료한 산행이나 백패킹 일정에 사진이나 GPX 경로를 저장하면 여기에 나타나요.';
  $('#hike-feed-cards').innerHTML = posts.map(record => `
    <button type="button" class="hike-feed-card" data-record="${escape(record.id)}">
      ${hasHikePhoto(record) ? '<img src="'+escape(record.hikePhoto)+'" alt="" loading="lazy" decoding="async">' : ''}
      <span class="hike-feed-card-body">
        <strong>${escape(record.name)}</strong>
        <span>${escape(scheduleDate(record, true))}${record.actualTime ? ' · '+escape(record.actualTime) : ''}</span>
        ${isCompletedCertification(record) ? '<span class="schedule-status status-certified">인증 완료</span>' : ''}
      </span>
      ${hikeTrackPreview(record.hikeTrack)}
    </button>`).join('');
}

function scheduleDate(record, includeYear) {
  if (!record.start) return '날짜 미정';
  const format = date => new Intl.DateTimeFormat('ko-KR', {
    year: includeYear ? 'numeric' : undefined, month: 'numeric', day: 'numeric', weekday: 'short', timeZone: 'Asia/Seoul'
  }).format(new Date(date+'T00:00:00+09:00'));
  return format(record.start) + (record.end && record.end !== record.start ? ' ~ '+format(record.end) : '');
}

function scheduleCard(record, displayView) {
  const category = categoryOf(record);
  const kind = calendarKind(record);
  const certification = isHike(category) && certificationTypes[certificationTypeOf(record)];
  const title = displayView === 'certified' ? record.certified.join(' · ') : record.name;
  const status = isCompletedCertification(record) ? 'certified' : record.status === 'done' ? 'done' : 'planned';
  const statusLabel = {planned:'예정',done:'완료',certified:'인증 완료'}[status];
  const labels = [categories[category], record.type, certification === '미정' ? '인증 미정' : certification].filter(Boolean);
  const gear = record.gear || [];
  const meeting = (record.notice || '').split('\n').map(line => line.trim())
    .filter(line => /^(집결(?:\s*(?:장소|시간))?|출발\s*(?:장소|시간))\s*[:：]/.test(line));
  const meetup = [record.meetingTime, record.meetingPlace].filter(Boolean).join(' ');
  const details = [...(meetup && isHike(category) ? ['집결 '+meetup] : meeting), record.region, record.host && '벙주 '+record.host, record.people != null && record.people !== '' && record.people+'명', record.transport, record.overnight !== '숙박 없음' && record.lodging, gear.length && '준비물 '+gear.filter(item => item.checked).length+'/'+gear.length].filter(Boolean);
  return `<button class="schedule-card card kind-${kind}" type="button" data-record="${escape(record.id)}">
    <span class="schedule-date">${escape(scheduleDate(record, displayView !== 'month'))}</span>
    <span class="schedule-card-body">
      <span class="schedule-card-head"><strong class="card-title">${escape(title)}</strong><span class="schedule-status status-${status}">${statusLabel}</span></span>
      <span class="schedule-tags">${calendarDot(kind)}${escape(labels.join(' · '))}</span>
      ${isHike(category) && hikingMetrics(record) ? '<span class="meta">'+escape(hikingMetrics(record))+'</span>' : ''}
      ${details.length ? '<span class="meta">'+escape(details.join(' · '))+'</span>' : ''}
    </span>
  </button>`;
}

function renderUpcoming(categories) {
  const container = $('#upcoming-schedule');
  if (!container) return;
  const upcoming = records.filter(record => record.status === 'planned' && record.start &&
    (record.end || record.start) >= today && categories.includes(categoryOf(record)))
    .sort((first, second) => first.start.localeCompare(second.start))[0];
  const mascot = $('.upcoming-mascot');
  if (mascot) {
    const character = crewMascots[crewMascotIndex[menu]];
    mascot.src = menu === 'all' ? 'forest-hiker-panda.webp' : 'crew-'+character+'.jpeg';
  }
  container.innerHTML = upcoming ? scheduleCard(upcoming, 'planned') : '<p class="upcoming-empty">다가오는 일정이 없어요.</p>';
}

function renderCalendar() {
  $('#calendar-key').hidden = menu === 'food' || menu === 'play';
  document.querySelectorAll('[data-calendar-kind]').forEach(item => item.hidden = menu !== 'all');
  const calendarRecords = records.filter(record => menus[menu].categories.includes(categoryOf(record)));
  const year = month.getFullYear();
  const index = month.getMonth();
  const prefix = iso(year,index,1).slice(0,7);
  $('#month').textContent = `${year}년 ${index+1}월`;
  const leading = new Date(year,index,1).getDay();
  const days = new Date(year,index+1,0).getDate();
  const includes = (record,day) => record.start && record.start <= day && (record.end || record.start) >= day;
  let html = [...'일월화수목금토'].map(day => `<span class="day-label">${day}</span>`).join('') + '<span></span>'.repeat(leading);
  for (let day=1; day<=days; day++) {
    const date = iso(year,index,day);
    const dayRecords = calendarRecords.filter(record => includes(record,date));
    const count = dayRecords.length;
    const kinds = [...new Set(dayRecords.map(calendarKind))];
    const kindLabels = kinds.map(kind => calendarKindLabels[kind]).join(', ');
    const fills = kinds.length ? `<span class="day-fills" aria-hidden="true">${kinds.map(kind => `<i class="${kind}"></i>`).join('')}</span>` : '';
    const label = [index+1+'월 '+day+'일', date === today ? '오늘' : '', count ? '일정 '+count+'건 · '+kindLabels : ''].filter(Boolean).join(', ');
    html += `<button type="button" class="day ${count ? 'has-event' : ''} ${date === today ? 'today' : ''}" data-day="${date}" aria-pressed="${date === selectedDay}" aria-label="${label}">${fills}<span class="day-number">${day}</span></button>`;
  }
  $('#calendar').innerHTML = html;
  const events = calendarRecords.filter(record => selectedDay ? includes(record,selectedDay) :
    record.start && record.start <= prefix+'-31' && (record.end || record.start) >= prefix+'-01');
  events.sort((a,b) => a.start.localeCompare(b.start));
  $('#events').innerHTML = `<h3>${selectedDay ? fmt(selectedDay) + ' 일정' : '이달의 일정'}</h3>` +
    (events.map(record => scheduleCard(record, selectedDay ? 'calendar' : 'month')).join('') || '<span class="hint">등록된 일정이 없어요.</span>');
}

function openEditor(record = {...blank(),start:selectedDay,category:$('#category-filter').value || menus[menu].categories[0]}) {
  editing = record;
  checks = new Set(record.certified);
  gear = structuredClone(record.gear);
  const transport = field('transport');
  transport.querySelector('[data-previous-value]')?.remove();
  if (record.transport && !Array.from(transport.options).some(option => option.value === record.transport)) {
    const previous = new Option(record.transport, record.transport);
    previous.dataset.previousValue = '';
    transport.add(previous);
  }
  for (const name of allFields) {
    if (field(name)) field(name).value = record[name] ?? '';
  }
  if ($('#hike-photo')) {
    photoRequest++;
    photoLoading = false;
    hikePhoto = hasHikePhoto(record) ? record.hikePhoto : '';
    $('#hike-photo').value = '';
    $('#hike-planning').open = false;
    $('#hike-log').open = false;
    $('#hike-notice-preview').hidden = true;
    $('#hike-notice-status').textContent = '';
    if ($('#hike-overview-message')) $('#hike-overview-message').textContent = '';
    renderHikePhoto();
    updateMapLink();
  }
  if ($('#hike-track')) {
    hikeRequest++;
    positionRequest++;
    hikeLoading = locatingHike = false;
    hikeTrack = hikeHasTrack(record.hikeTrack) ? record.hikeTrack : null;
    hikePins = Object.fromEntries(Object.keys(hikePinLabels)
      .filter(id => validHikePoint(record.hikePins?.[id])).map(id => [id, record.hikePins[id]]));
    $('#hike-track').value = '';
    $('#hike-location').open = false;
    $('#hike-pin-status').textContent = '';
    renderHikePins();
    renderHikeTrack();
  }
  field('category').value = categoryOf(record);
  field('certificationType').value = record.certificationType || (record.id ? certificationTypeOf(record) : $('#certification-filter').value || 'island');
  bacLinks = Array.isArray(record.bacLinks) ? record.bacLinks : [];
  if ($('#bac-search')) {
    $('#bac-search').value = '';
    renderBacSearch();
  }
  field('end').setCustomValidity('');
  field('name').setCustomValidity('');
  $('#gear-name').value = '';
  $('#schedule-details').open = false;
  $('#editor-title').textContent = record.id ? '일정 상세' : '새 일정';
  const deleteButton = $('#delete-schedule');
  if (deleteButton) deleteButton.hidden = !record.id;
  $('#complete').textContent = record.status === 'done' ? '완료 취소' : '완료 처리';
  layoutScheduleSections(true);
  renderCategory();
  renderGear();
  dialog.showModal();
  if ($("#editor-sections")) $(".editor-content").scrollTop = 0;
}

function renderCategory() {
  const hike = isHike(field('category').value);
  $('#record-name-label').textContent = hike ? '산 이름' : '모임 이름';
  field('name').placeholder = hike ? '예) 가라산' : '예) 연말 저녁 모임';
  $('#certification').hidden = $('#certification-type-field').hidden = !hike;
  $('#category-field').classList.toggle('full-width-field', !hike);
  for (const section of [$('#hike-planning'), $('#hike-log'), $('#hike-media')]) {
    if (!section) continue;
    section.hidden = !hike;
    for (const input of section.querySelectorAll('input, select, textarea')) input.disabled = !hike;
  }
  if ($('#hike-location')) $('#hike-location').hidden = !hike || !editing.id;
  const camping = $('#backpacking-fields');
  if (camping) camping.hidden = camping.disabled = field('category').value !== 'backpacking';
  const noticeButton = $('#build-hike-notice');
  if (noticeButton) {
    noticeButton.hidden = !hike;
    if (!hike) $('#hike-notice-preview').hidden = true;
  }
  renderPeaks();
}

function renderPeaks() {
  renderBacLinks();
  renderHikeOverview();
  $('#peaks').innerHTML = certificationPoints({name:field('name').value, peakNames:field('peakNames')?.value}).map(name =>
    `<label class="checkrow"><input type="checkbox" value="${escape(name)}" ${checks.has(name) ? 'checked' : ''}> ${escape(name)} 인증 완료</label>`
  ).join('') || '<p class="hint">산 이름을 입력하면 인증 여부를 체크할 수 있어요.</p>';
}

function mapLink(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch {
    return '';
  }
}

function updateMapLink() {
  const input = field('mapUrl');
  const link = $('#open-map');
  const url = mapLink(input.value.trim());
  input.setCustomValidity(input.value.trim() && !url ? 'http:// 또는 https://로 시작하는 지도 링크를 입력해 주세요.' : '');
  link.hidden = !url;
  if (url) link.href = url;
  else link.removeAttribute('href');
}

function renderHikePhoto(message = '') {
  const preview = $('#hike-photo-preview');
  preview.hidden = $('#remove-hike-photo').hidden = !hikePhoto;
  if (hikePhoto) preview.src = hikePhoto;
  else preview.removeAttribute('src');
  $('#hike-photo-status').textContent = message;
}

async function loadHikePhoto(event) {
  const input = event.currentTarget;
  const file = input.files[0];
  input.value = '';
  if (!file) return;
  const request = ++photoRequest;
  photoLoading = true;
  renderHikePhoto('사진 불러오는 중…');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 640 / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    let photo = canvas.toDataURL('image/jpeg', 0.62);
    if (photo.length > 180000) photo = canvas.toDataURL('image/jpeg', 0.35);
    if (!photo.startsWith('data:image/jpeg;base64,') || photo.length > 180000) throw new Error('Invalid photo');
    if (request === photoRequest && dialog.open) {
      hikePhoto = photo;
      renderHikePhoto('사진을 첨부했어요. 저장하면 일정에 남아요.');
    }
  } catch {
    if (request === photoRequest && dialog.open) renderHikePhoto('사진을 열지 못했어요. JPG 또는 PNG 사진으로 다시 시도해 주세요.');
  } finally {
    URL.revokeObjectURL(url);
    if (request === photoRequest) photoLoading = false;
  }
}

function hikeNoticeText() {
  const record = readScheduleFields();
  const route = [record.trailhead, record.waypoints, record.summit, record.trailEnd].filter(Boolean).join(' → ');
  const meetup = [record.meetingTime, record.meetingPlace].filter(Boolean).join(' · ');
  const lines = [
    ['📅 일정', record.start && scheduleDate(record, true)],
    ['🗺️ 지역', record.region], ['📍 집결', meetup], ['🔗 지도', mapLink(record.mapUrl)],
    ['🥾 코스', route], ['🧭 코스 유형', record.routeType], ['📏 거리', record.distance && record.distance+'km'],
    ['↗️ 예상 누적 상승', record.plannedAscent && record.plannedAscent+'m'], ['⏱️ 예상 소요시간', record.estimatedTime], ['⛰️ 난이도', record.difficulty],
    ['🙋 벙주', record.host], ['👥 인원', record.people && record.people+'명'],
    ['🚗 교통', record.transport], ['🅿️ 주차', record.parking], ['🚙 차량 회수', record.vehiclePickup],
    ['🏠 숙소', record.lodging], ['💰 예산', record.budget && Number(record.budget).toLocaleString('ko-KR')+'원'],
    ['🎒 준비물', gear.map(item => item.label).filter(Boolean).join(', ')],
    ['🏅 인증', [certificationTypes[record.certificationType], certificationPoints(record).join(' · ')].filter(Boolean).join(' · ')]
  ];
  if (record.category === 'backpacking') {
    lines.push(['⛺ 야영지', record.campsite], ['🗓️ 예약', record.campBooking], ['💧 물 보급', record.waterSource]);
  }
  const title = record.name ? '🏔️ '+record.name+' 산행' : '🏔️ 산행 안내';
  const details = lines.filter(([,value]) => value).map(([label,value]) => label+'　'+value).join('\n');
  const note = record.notice ? '💬 벙주 한마디\n'+record.notice : '';
  return [title, details, note].filter(Boolean).join('\n\n');
}

function buildHikeNotice() {
  $('#hike-notice-text').value = hikeNoticeText();
  $('#hike-notice-preview').hidden = false;
  $('#hike-notice-status').textContent = '';
  $('#hike-notice-text').focus();
}

async function copyHikeNotice(fromOverview = false) {
  const record = editing;
  const preview = $('#hike-notice-text');
  const text = fromOverview ? hikeNoticeText() : preview.value;
  const status = $(fromOverview ? '#hike-overview-message' : '#hike-notice-status');
  try {
    await navigator.clipboard.writeText(text);
    if (dialog.open && editing === record) status.textContent = '공지 초안을 복사했어요.';
  } catch {
    if (!dialog.open || editing !== record) return;
    if (fromOverview) {
      revealScheduleSection('schedule-notice');
      buildHikeNotice();
    }
    preview.focus();
    preview.select();
    $('#hike-notice-status').textContent = '선택된 공지 초안을 복사해 주세요.';
  }
}

function renderGear() {
  $('#gear').innerHTML = gear.map((item,index) => `<div class="inline"><label class="checkrow"><input type="checkbox" data-gear="${index}" ${item.checked ? 'checked' : ''}> ${escape(item.label)}</label><button type="button" data-remove="${index}" aria-label="${escape(item.label)} 삭제">×</button></div>`).join('');
}

function addGear() {
  const input = $('#gear-name');
  const label = input.value.trim();
  if (!label) return;
  gear.push({label,checked:false});
  input.value = '';
  renderGear();
  input.focus();
}

function showEditorError(message) {
  form.querySelector('.save-error')?.remove();
  const error = document.createElement('p');
  error.className = 'save-error';
  error.setAttribute('role','alert');
  error.textContent = message;
  $('.dialog-actions').before(error);
}

async function removeSchedule() {
  if (pendingOperation || !editing?.id) return;
  const {id, name} = editing;
  if (!window.confirm('‘'+name+'’ 일정을 삭제할까요?')) return;
  const uid = account?.uid;
  setSyncBusy(true);
  try {
    if (uid) {
      if (!cloudReady || !navigator.onLine) throw new Error('Unavailable sync');
      await sync.removeSchedule(uid, id);
      if (account?.uid !== uid) return;
    } else {
      const remaining = localRecords().filter(record => record.id !== id);
      localStorage.setItem(key, JSON.stringify(remaining));
      records = remaining;
    }
    records = records.filter(record => record.id !== id);
    dialog.close();
    render();
    feedback('일정을 삭제했어요.');
  } catch {
    if (account?.uid === uid && dialog.open) showEditorError('일정을 삭제하지 못했어요. 연결이나 저장 공간을 확인하고 다시 시도해 주세요.');
  } finally {
    setSyncBusy(false);
  }
}

async function save(statusOverride) {
  if (pendingOperation) return;
  const start = field('start').value;
  const end = field('end').value;
  field('end').setCustomValidity(end && (!start || end < start) ? '종료 날짜는 시작 날짜와 같거나 이후여야 해요.' : '');
  const hike = isHike(field('category').value);
  const name = field('name').value.trim();
  field('name').setCustomValidity((hike ? names(name).length : name) ? '' : '일정 이름을 입력해 주세요.');
  if (!form.reportValidity()) return;
  if (hike && (hikeLoading || locatingHike)) {
    showEditorError('위치 또는 GPX를 불러오는 중이에요. 잠시 뒤 저장해 주세요.');
    return;
  }
  if (photoLoading) {
    showEditorError('사진을 불러오는 중이에요. 잠시 뒤 저장해 주세요.');
    return;
  }
  const record = readScheduleFields();
  if ($('#hike-photo')) record.hikePhoto = hikePhoto;
  if ($('#hike-track')) Object.assign(record, {hikePins, hikeTrack});
  else {
    if (editing.hikePins) record.hikePins = editing.hikePins;
    if (editing.hikeTrack) record.hikeTrack = editing.hikeTrack;
  }
  Object.assign(record,{id:editing.id || crypto.randomUUID(),gear,certified:hike ? certificationPoints(record).filter(name => checks.has(name)) : []});
  if (hike && $('#bac-search')) record.bacLinks = scheduleBacLinks(bacLinks, record.certificationType, certificationPoints(record));
  else if (editing.bacLinks) record.bacLinks = editing.bacLinks;
  if (statusOverride) record.status = statusOverride;
  const nextRecords = [...records.filter(item => item.id !== record.id),record];
  const uid = account?.uid;
  try {
    if (uid) {
      if (!cloudReady || !navigator.onLine) throw new Error('Unavailable sync');
      setSyncBusy(true);
      await sync.saveSchedule(uid, record);
      if (account?.uid !== uid) return;
    } else {
      localStorage.setItem(key,JSON.stringify(nextRecords));
    }
  } catch {
    showEditorError(uid ? '계정에 저장할 수 없어요. 연결 상태를 확인한 뒤 다시 저장해 주세요.' : '브라우저에서 저장할 수 없어요. 저장 공간이나 브라우저 설정을 확인해 주세요.');
    return;
  }
  finally {
    if (uid) setSyncBusy(false);
  }
  records = [...records.filter(item => item.id !== record.id),record];
  dialog.close();
  if (!menus[menu].categories.includes(record.category)) {
    menu = ['hike','food','play'].find(key => menus[key].categories.includes(record.category)) || 'all';
  }
  view = record.status === 'planned' ? 'planned' : isCompletedCertification(record) ? 'certified' : 'done';
  if ($('#filter').value && $('#filter').value !== record.type) $('#filter').value = '';
  if ($('#category-filter').value && $('#category-filter').value !== record.category) $('#category-filter').value = '';
  if ($('#certification-filter').value && $('#certification-filter').value !== record.certificationType) $('#certification-filter').value = '';
  if (record.start) {
    month = new Date(record.start.slice(0,7)+'-01T00:00:00');
    selectedDay = '';
  }
  render();
  const message = {done:'일정을 완료 처리했어요.', planned:'완료를 취소하고 예정 일정으로 돌렸어요.'};
  feedback(message[statusOverride] || '일정을 저장했어요.');
}

$('#export-backup').onclick = () => {
  if (readError && !account) {
    feedback('저장된 기록을 불러올 수 없어 백업할 수 없어요.');
    return;
  }
  const backup = JSON.stringify({version:1,records},null,2);
  const url = URL.createObjectURL(new Blob([backup],{type:'application/json'}));
  const link = document.createElement('a');
  link.href = url;
  link.download = `오르내림-캘린더-${today}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url),1000);
};

$('#add').onclick = () => openEditor();
$('#close').onclick = () => dialog.close();
dialog.addEventListener('close', () => form.querySelector('.save-error')?.remove());
$('#filter').onchange = $('#category-filter').onchange = $('#certification-filter').onchange = render;
$('.activity-menu').onclick = event => {
  const button = event.target.closest('[data-menu]');
  if (!button || (!showingHikeFeed && button.dataset.menu === menu)) return;
  showingHikeFeed = false;
  menu = button.dataset.menu;
  if (Object.hasOwn(crewMascotIndex, menu)) {
    crewMascotIndex[menu] = (crewMascotIndex[menu] + 1) % crewMascots.length;
  }
  view = 'planned';
  $('#filter').value = '';
  $('#category-filter').value = '';
  $('#certification-filter').value = '';
  render();
};
const feedTab = $('#hike-feed-tab');
if (feedTab) {
  feedTab.hidden = false;
  feedTab.onclick = () => {
    if (showingHikeFeed) return;
    showingHikeFeed = true;
    render();
  };
}
const certificationShortcut = $('#certification-shortcut');
if (certificationShortcut) certificationShortcut.onclick = () => {
  $('[data-menu="hike"]').click();
  $('#certification-heading').focus();
};
field('category').onchange = () => {
  field('name').setCustomValidity('');
  layoutScheduleSections();
  renderCategory();
};
$('.tabs').onclick = event => {
  const tab = event.target.closest('[data-view]');
  if (!tab) return;
  view = tab.dataset.view;
  $('#filter').value = '';
  render();
  document.querySelector(`[data-view="${view}"]`).focus();
};
document.addEventListener('click',event => {
  if (event.target.closest('[data-add-schedule]')) {
    openEditor();
    return;
  }
  const button = event.target.closest('[data-record]');
  if (!button) return;
  const record = records.find(item => item.id === button.dataset.record);
  if (!record) return;
  openEditor(record);
  if (button.classList.contains('hike-feed-card')) ($('#hike-media') || $('#hike-log')).open = true;
});
$('#calendar').onclick = event => {
  const day = event.target.closest('[data-day]');
  if (!day) return;
  selectedDay = selectedDay === day.dataset.day ? '' : day.dataset.day;
  renderCalendar();
  document.querySelector(`[data-day="${day.dataset.day}"]`).focus();
};
function moveMonth(offset) {
  month = new Date(month.getFullYear(),month.getMonth()+offset,1);
  selectedDay = '';
  renderCalendar();
}
$('#prev').onclick = () => moveMonth(-1);
$('#next').onclick = () => moveMonth(1);
$('#current').onclick = () => {
  month = new Date(today.slice(0,7)+'-01T00:00:00');
  selectedDay = '';
  renderCalendar();
};
if ($('#hike-photo')) {
  if ($('#hike-track')) {
    $('#hike-pin-list').onclick = handleHikePin;
    $('#hike-track').onchange = loadHikeTrack;
    $('#remove-hike-track').onclick = () => {
      hikeRequest++;
      hikeLoading = false;
      hikeTrack = null;
      renderHikeTrack('GPX 경로를 제거했어요. 일정에서 저장하면 반영돼요.');
      $('#hike-track').focus();
    };
    for (const name of ['distance','estimatedTime','plannedAscent','actualDistance','actualTime','actualAscent']) {
      field(name).addEventListener('input', refreshHikeComparison);
    }
  }
  field('peakNames').oninput = renderPeaks;
  field('mapUrl').oninput = updateMapLink;
  $('#hike-photo').onchange = loadHikePhoto;
  $('#remove-hike-photo').onclick = () => {
    photoRequest++;
    photoLoading = false;
    hikePhoto = '';
    renderHikePhoto('첨부 사진을 제거했어요.');
  };
  $('#build-hike-notice').onclick = buildHikeNotice;
  $('#copy-hike-notice').onclick = () => copyHikeNotice();
}
if ($('#bac-search')) initBacPicker();
if ($('#bac-progress')) initBacProgress();
if ($('#hike-overview')) {
  $('#hike-overview').onclick = event => {
    const section = event.target.closest('[data-hike-jump]')?.dataset.hikeJump;
    if (section) revealScheduleSection(section);
  };
  $('#hike-overview-copy').onclick = () => copyHikeNotice(true);
  for (const name of ['start','end','meetingTime','meetingPlace','trailhead','distance','estimatedTime','mapUrl','certificationType']) {
    field(name).addEventListener('input', renderHikeOverview);
  }
  field('status').addEventListener('change', () => {
    layoutScheduleSections();
    renderHikeOverview();
  });
}
field('name').oninput = () => {field('name').setCustomValidity('');renderPeaks();};
field('start').oninput = field('end').oninput = () => field('end').setCustomValidity('');
$('#peaks').onchange = ({target}) => {
  if (target.checked) checks.add(target.value);
  else checks.delete(target.value);
};
$('#gear').onchange = ({target}) => gear[Number(target.dataset.gear)].checked = target.checked;
$('#gear').onclick = event => {
  const button = event.target.closest('[data-remove]');
  if (!button) return;
  gear.splice(Number(button.dataset.remove),1);
  renderGear();
  $('#gear-name').focus();
};
$('#gear-add').onclick = addGear;
$('#gear-name').onkeydown = event => {
  if (event.key === 'Enter' && !event.isComposing) {
    event.preventDefault();
    addGear();
  }
};
if ($('#delete-schedule')) $('#delete-schedule').onclick = removeSchedule;
$('#complete').onclick = () => save(editing.status === 'done' ? 'planned' : 'done');
form.addEventListener('invalid', event => {
  const details = event.target.closest('details');
  if (details) details.open = true;
},true);
form.onsubmit = event => {
  event.preventDefault();
  save();
};
render();
if (readError) feedback('저장된 기록을 불러올 수 없어 기본 일정을 표시했어요.');

function setSyncBusy(busy) {
  pendingOperation = busy;
  for (const button of document.querySelectorAll('#google-login, #google-logout, #import-local, .dialog-actions button')) {
    button.disabled = busy;
  }
}

function changeAccount(user) {
  stopSchedules?.();
  account = user;
  cloudReady = false;
  if (dialog.open) dialog.close();
  view = 'planned';
  $('#google-login').hidden = Boolean(user);
  $('#google-logout').hidden = !user;
  $('#import-local').hidden = true;
  const status = $('#sync-status');
  records = [];
  if (!user) {
    try {
      records = localRecords();
      readError = false;
    } catch { readError = true; }
    status.textContent = '이 브라우저에 저장 중';
    render();
    return;
  }
  status.textContent = '계정 일정 불러오는 중…';
  render();
  stopSchedules = sync.observeSchedules(user.uid, incoming => {
    if (account?.uid !== user.uid) return;
    cloudReady = true;
    records = incoming.filter(record => record.deleted !== true);
    status.textContent = '동기화 중: ' + (user.email || 'Google 계정');
    try {
      const cloudIds = new Set(incoming.map(record => record.id));
      $('#import-local').hidden = !localRecords().some(record => !cloudIds.has(record.id));
    } catch { $('#import-local').hidden = true; }
    render();
  }, () => {
    cloudReady = false;
    status.textContent = '계정 일정에 연결할 수 없어요.';
    if (showingHikeFeed) render();
    else renderBacProgress();
  });
}

async function runAccountAction(action, errorMessage) {
  if (pendingOperation) return;
  setSyncBusy(true);
  try { await action(); }
  catch { feedback(errorMessage); }
  finally { setSyncBusy(false); }
}

if ($('#sync-status')) import('./sync.mjs?v=schedule-deletion').then(module => {
  sync = module;
  module.observeAccount(changeAccount);
  $('#google-login').onclick = () => runAccountAction(module.login,'Google 로그인에 실패했어요. 팝업을 허용한 뒤 다시 시도해 주세요.');
  $('#google-logout').onclick = () => runAccountAction(module.logout,'로그아웃에 실패했어요. 다시 시도해 주세요.');
  $('#import-local').onclick = () => runAccountAction(async () => {
    if (!account || !cloudReady || !navigator.onLine) throw new Error('Unavailable sync');
    const source = new Map(localRecords().map(record => [record.id,record]));
    await module.importSchedules(account.uid,[...source.values()]);
    feedback('이 브라우저의 일정을 계정으로 가져왔어요.');
  },'일정을 가져오지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요.');
}).catch(() => {
  $('#sync-status').textContent = 'Google 연결을 불러올 수 없어요. 이 브라우저에 저장 중이에요.';
});
