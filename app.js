'use strict';

const $ = selector => document.querySelector(selector);
const names = value => value.split('·').map(part => part.trim()).filter(Boolean);
const key = 'seom-mountain-log:v1';
const certificationGoals = {classic:100, plus:114, island:100};
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
const hikePhotoLimit = 5;
let hikePhotos = [];
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
const validHikePhoto = photo => typeof photo === 'string' && photo.length <= 180000 &&
  /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(photo);
const savedHikePhotos = record => [record.hikePhoto, ...(Array.isArray(record.hikeExtraPhotos) ? record.hikeExtraPhotos : [])]
  .filter(validHikePhoto).slice(0, hikePhotoLimit);
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

function pandaStamp(record, size = 'card') {
  const date = (record.end || record.start || '').replaceAll('-', '.');
  const label = '인증 완료 도장' + (date ? ', ' + date : '');
  return `<svg class="panda-stamp panda-stamp-${size}" viewBox="0 0 100 100" role="img" aria-label="${escape(label)}">
    <g filter="url(#stamp-ink)" fill="currentColor">
      <circle cx="50" cy="50" r="47" fill="none" stroke="currentColor" stroke-width="3.2"/>
      <circle cx="50" cy="50" r="41.5" fill="none" stroke="currentColor" stroke-width="1.1"/>
      <text class="panda-stamp-top"><textPath href="#stamp-arc-top" startOffset="50%" text-anchor="middle">인증 완료</textPath></text>
      ${date ? `<text class="panda-stamp-date"><textPath href="#stamp-arc-bottom" startOffset="50%" text-anchor="middle">${escape(date)}</textPath></text>` : ''}
      <circle cx="17.5" cy="54" r="1.6"/><circle cx="82.5" cy="54" r="1.6"/>
      <rect x="0" y="0" width="100" height="100" transform="translate(7 10) scale(.86)" mask="url(#stamp-panda-face)"/>
    </g>
  </svg>`;
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

const bacAlternateRegions = {
  'classic:백운산(동강)': ['동간'],
  'classic:운악산': ['경기 포천', '경기 가평'],
  'classic:금정산': ['부산', '부산 금정'],
  'classic:팔공산': ['대구', '대구 동구', '대구 군위'],
  'plus:수리산(경기 안양)': ['경기 군포']
};

function bacRegionMatches(place, region) {
  const normalized = bacKey(region).replace(/(특별시|광역시|특별자치도|도|시|군)$/u, '');
  if (!normalized) return true;
  const nameRegion = place.name.match(/\(([^)]+)\)/)?.[1] || '';
  return [place.region, nameRegion, ...(bacAlternateRegions[place.id] || [])]
    .some(area => bacKey(area).includes(normalized));
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

let overviewWeatherTimer = 0;
function renderHikeOverview() {
  const overview = $('#hike-overview');
  if (!overview) return;
  const record = readScheduleFields();
  overview.hidden = !isHike(record.category);
  if (overview.hidden) return;
  const done = record.status === 'done';
  $('#hike-overview-name').textContent = record.name || '산행 요약';
  $('#hike-overview-status').textContent = done ? '완료' : '예정';
  const certifiedNow = done && checks.size > 0 && record.certificationType !== 'undecided';
  const stampSlot = $('#hike-overview-stamp');
  if (stampSlot) {
    const wasStamped = stampSlot.dataset.stamped === 'true';
    stampSlot.innerHTML = certifiedNow ? pandaStamp(record, 'overview') : '';
    stampSlot.dataset.stamped = certifiedNow;
    stampSlot.classList.toggle('stamp-in', certifiedNow && !wasStamped && dialog.open);
    $('#hike-overview-status').hidden = certifiedNow;
  }
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
  clearTimeout(overviewWeatherTimer);
  overviewWeatherTimer = setTimeout(() => showWeather($('#hike-overview-weather'), {...record, hikePins:editing.hikePins}), 600);
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

const sharePrefix = '#schedule=';
const sharedFields = {
  name:'일정 이름', category:'모임 종류', start:'시작 날짜', end:'종료 날짜', region:'지역', type:'일정 유형',
  meetingTime:'집결 시간', meetingPlace:'집결 장소', trailhead:'들머리', waypoints:'경유지', summit:'정상',
  trailEnd:'날머리', routeType:'코스 유형', distance:'거리 (km)', estimatedTime:'예상 소요시간',
  plannedAscent:'예상 상승고도 (m)', difficulty:'난이도', transport:'교통수단', parking:'주차장',
  vehiclePickup:'차량 회수', mapUrl:'지도 링크', certificationType:'인증 유형', peakNames:'인증 포인트'
};
let sharedSchedule;
let shareMode = '';

function cleanSharedSchedule(input) {
  if (!input || typeof input !== 'object' || !Object.hasOwn(categories, input.category)) return null;
  const record = {};
  for (const name of Object.keys(sharedFields)) {
    if (typeof input[name] === 'string' && input[name].trim()) {
      record[name] = input[name].trim().slice(0, name === 'mapUrl' ? 600 : 240);
    }
  }
  if (!record.name || (isHike(record.category) && !names(record.name).length)) return null;
  for (const name of ['start','end']) {
    const date = record[name];
    if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date)) return null;
  }
  if (record.end && (!record.start || record.end < record.start)) return null;
  if (!isHike(record.category)) {
    delete record.certificationType;
    delete record.peakNames;
  } else if (!Object.hasOwn(certificationTypes, record.certificationType)) {
    record.certificationType = 'undecided';
  }
  if (record.mapUrl && !mapLink(record.mapUrl)) delete record.mapUrl;
  record.gear = Array.isArray(input.gear) ? input.gear.slice(0, 25).filter(item => typeof item?.label === 'string' && item.label.trim())
    .map(item => ({label:item.label.trim().slice(0, 80), checked:false})) : [];
  return record;
}

function encodeScheduleShare(record, id) {
  return encodeURIComponent(JSON.stringify({v:1, id, record}));
}

function decodeScheduleShare(hash) {
  try {
    if (hash.length > 6500) return null;
    const data = JSON.parse(decodeURIComponent(hash.slice(sharePrefix.length)));
    if (data.v !== 1 || typeof data.id !== 'string' || !/^[a-f0-9-]{36}$/.test(data.id)) return null;
    const record = cleanSharedSchedule(data.record);
    return record ? {...blank(), ...record, id:'shared-'+data.id, status:'planned'} : null;
  } catch {
    return null;
  }
}

function showScheduleShare(mode, record) {
  const share = $('#schedule-share-dialog');
  shareMode = mode;
  sharedSchedule = record;
  $('#schedule-share-title').textContent = mode === 'send' ? '일정 공유하기' : '공유 일정';
  $('#schedule-share-note').textContent = mode === 'send' ? '저장된 일정의 아래 내용이 공유돼요. 링크를 받은 사람은 누구나 볼 수 있어요.' : '공유 당시 일정이에요. 담으면 내 캘린더에 예정 일정으로 저장돼요.';
  $('#schedule-share-copy').hidden = mode !== 'send';
  $('#schedule-share-save').hidden = mode !== 'receive';
  $('#schedule-share-url-row').hidden = true;
  const help = loginBrowserHelp(true);
  if (help) help.hidden = true;
  $('#schedule-share-url').value = '';
  $('#schedule-share-status').textContent = record ? '' : '공유 링크를 읽을 수 없어요.';
  const values = record ? Object.entries(sharedFields).filter(([key]) => record[key]).map(([key,label]) => {
    const value = key === 'category' ? categories[record[key]] : key === 'certificationType' ? certificationTypes[record[key]] : record[key];
    return [label,value];
  }) : [];
  if (record?.gear.length) values.push(['준비물', record.gear.map(item => item.label).join(' · ')]);
  $('#schedule-share-data').innerHTML = values.map(([label,value]) => '<div><dt>'+escape(label)+'</dt><dd>'+escape(value)+'</dd></div>').join('');
  updateScheduleShare();
  if (!share.open) share.showModal();
}

function updateScheduleShare() {
  if (shareMode !== 'receive') return;
  const button = $('#schedule-share-save');
  const existing = account && records.some(item => item.id === sharedSchedule?.id);
  button.textContent = existing ? '이미 담은 일정이에요' : account ? '내 캘린더에 담기' : 'Google 로그인하고 담기';
  button.disabled = !sharedSchedule || pendingOperation || !!existing || (account ? !cloudReady : !sync);
  const browserHandoff = Boolean(sharedSchedule && !account && isInAppLoginBrowser() && loginBrowserHelp(true));
  button.hidden = browserHandoff;
  if (browserHandoff && loginBrowserHelp(true).hidden) {
    showLoginHelp(true, '카카오톡 같은 앱 안에서는 구글 로그인이 제한돼요. 아래 버튼으로 이 일정 링크를 복사하고 Safari나 Chrome 주소창에 붙여넣어 주세요.');
  }
  if (account && !cloudReady && sharedSchedule) {
    $('#schedule-share-status').textContent = $('#sync-status').textContent;
  }
}

function isInAppLoginBrowser(userAgent = navigator.userAgent) {
  return /KAKAOTALK|NAVER\(inapp|Instagram|FBAN|FBAV/i.test(userAgent);
}

function loginBrowserHelp(shared) {
  return $(shared ? '#share-login-help' : '#calendar-login-help');
}

function showLoginHelp(shared, message) {
  const help = loginBrowserHelp(shared);
  if (!help) {
    if (shared) $('#schedule-share-status').textContent = message;
    else feedback(message);
    return;
  }
  help.querySelector('[role="status"]').textContent = message;
  help.hidden = false;
}

async function loginWithBrowserHelp(shared = false) {
  if (!navigator.onLine) {
    feedback('오프라인이에요. 인터넷에 연결되면 로그인할 수 있어요.');
    return;
  }
  if (!sync || pendingOperation) return;
  const help = loginBrowserHelp(shared);
  if (help) {
    help.hidden = true;
    help.querySelector('input').hidden = true;
  }
  const status = shared ? $('#schedule-share-status') : null;
  if (status) status.textContent = '';
  if (isInAppLoginBrowser()) {
    showLoginHelp(shared, '앱 안에서 구글 로그인 창이 열리지 않을 수 있어요. 링크를 복사해 Safari나 Chrome 주소창에 붙여넣고 다시 눌러 주세요.');
    return;
  }
  setSyncBusy(true);
  if (status) status.textContent = 'Google 로그인 창을 확인해 주세요.';
  try {
    await sync.login();
    if (status && shareMode === 'receive') status.textContent = '로그인했어요. 내 캘린더에 담기를 눌러 주세요.';
  } catch (error) {
    if (shared && (shareMode !== 'receive' || !$('#schedule-share-dialog').open)) return;
    if (status) status.textContent = '';
    const message = {
      'auth/popup-blocked':'구글 로그인 팝업이 차단됐어요. 이 사이트의 팝업을 허용한 뒤 다시 누르거나 Safari·Chrome에서 링크를 열어 주세요.',
      'auth/popup-closed-by-user':'구글 로그인 창이 닫혔어요. 다시 누르거나 Safari·Chrome에서 링크를 열어 주세요.',
      'auth/cancelled-popup-request':'구글 로그인 요청이 취소됐어요. 다시 눌러 주세요.',
      'auth/network-request-failed':'인터넷 연결을 확인한 뒤 다시 눌러 주세요.',
      'auth/unauthorized-domain':'이 주소의 구글 로그인이 설정에 등록되지 않았어요. 운영진에게 알려 주세요.'
    }[error?.code];
    showLoginHelp(shared, message || '구글 로그인 창을 열지 못했어요. 링크를 복사해 Safari나 Chrome에서 다시 시도해 주세요.');
  } finally {
    setSyncBusy(false);
  }
}

function initLoginBrowserHelp() {
  for (const help of document.querySelectorAll('[data-login-help]')) {
    help.querySelector('button').onclick = async () => {
      const link = location.href;
      const status = help.querySelector('[role="status"]');
      try {
        await navigator.clipboard.writeText(link);
        status.textContent = '링크를 복사했어요. Safari나 Chrome 주소창에 붙여넣어 주세요.';
      } catch {
        const input = help.querySelector('input');
        input.hidden = false;
        input.value = link;
        input.focus();
        input.select();
        status.textContent = '링크를 길게 눌러 복사한 뒤 Safari나 Chrome에서 열어 주세요.';
      }
    };
  }
}

function initScheduleShare() {
  const share = $('#schedule-share-dialog');
  $('#share-schedule').onclick = () => {
    const saved = records.find(record => record.id === editing.id);
    const record = cleanSharedSchedule(saved);
    if (record) showScheduleShare('send', record);
    else feedback('공유하려면 일정 이름과 날짜를 확인하고 저장해 주세요.');
  };
  $('#schedule-share-close').onclick = () => share.close();
  share.onclose = () => {
    if (share.open) return;
    if (shareMode === 'receive' && location.hash.startsWith(sharePrefix)) {
      history.replaceState(null, '', location.pathname + location.search);
    }
    shareMode = '';
    sharedSchedule = null;
  };
  $('#schedule-share-copy').onclick = async () => {
    const output = $('#schedule-share-url');
    const status = $('#schedule-share-status');
    if (!output.value) {
      const packed = encodeScheduleShare(sharedSchedule, crypto.randomUUID());
      if (packed.length > 6400) {
        status.textContent = '공유 링크가 너무 길어요. 일정의 코스나 준비물 내용을 줄이고 다시 저장해 주세요.';
        return;
      }
      output.value = new URL('.', location.href).href + sharePrefix + packed;
    }
    $('#schedule-share-url-row').hidden = false;
    try {
      await navigator.clipboard.writeText(output.value);
      status.textContent = '공유 링크를 복사했어요.';
    } catch {
      output.focus();
      output.select();
      status.textContent = '선택된 공유 링크를 복사해 주세요.';
    }
  };
  $('#schedule-share-save').onclick = async () => {
    if (!sharedSchedule || !sync || pendingOperation) return;
    const status = $('#schedule-share-status');
    if (!account) {
      await loginWithBrowserHelp(true);
      return;
    }
    if (!cloudReady) return;
    const uid = account.uid;
    const record = sharedSchedule;
    setSyncBusy(true);
    try {
      const added = await sync.addSharedSchedule(uid, record);
      if (account?.uid !== uid || record !== sharedSchedule) return;
      if (added) {
        records = [...records.filter(item => item.id !== record.id), record];
        view = 'planned';
        if (record.start) {
          month = new Date(record.start.slice(0,7)+'-01T00:00:00');
          selectedDay = '';
        }
      }
      render();
      status.textContent = added ? '내 캘린더에 일정을 담았어요.' : '이미 담은 일정이에요.';
      if (added) {
        share.close();
        openEditor(record);
        feedback('내 캘린더에 일정을 담았어요.');
      } else $('#schedule-share-save').disabled = true;
    } catch {
      status.textContent = '일정을 담지 못했어요. 연결 상태를 확인한 뒤 다시 시도해 주세요.';
    } finally {
      setSyncBusy(false);
    }
  };
  const openIncoming = () => {
    if (location.hash.startsWith(sharePrefix)) showScheduleShare('receive', decodeScheduleShare(location.hash));
  };
  window.addEventListener('hashchange', openIncoming);
  openIncoming();
}

function initBacProgress() {
  const panel = $('#bac-progress');
  $('#certification-cards').onclick = event => {
    const card = event.target.closest('[data-certification-list]');
    if (!card) return;
    $('#bac-progress-type').value = card.dataset.certificationList;
    $('#bac-progress-status').value = 'done';
    $('#bac-progress-search').value = '';
    bacListLimit = bacPageSize;
    panel.open = true;
    renderBacProgress();
    const heading = panel.querySelector('summary');
    heading.focus({preventScroll:true});
    heading.scrollIntoView({block:'nearest'});
  };
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

function summitMeter(percent, type) {
  const ridge = 'M0 60 L14 44 L24 50 L40 26 L52 36 L66 8 L80 30 L92 22 L108 42 L120 36 L120 60 Z';
  const level = 60 - percent * 0.52;
  return `<svg class="summit-meter" viewBox="0 -8 120 68" preserveAspectRatio="none" aria-hidden="true">
    <defs><clipPath id="meter-${type}"><rect x="0" y="${level}" width="120" height="${60 - level}"/></clipPath></defs>
    <path class="summit-meter-bg" d="${ridge}"/><path class="summit-meter-fill" d="${ridge}" clip-path="url(#meter-${type})"/>
    ${percent > 0 && percent < 100 ? `<line class="summit-meter-line" vector-effect="non-scaling-stroke" x1="0" x2="120" y1="${level}" y2="${level}"/>` : ''}
    ${percent >= 100 ? '<path class="summit-flag" d="M66 8 V-6 L76 -2 L66 2"/>' : ''}</svg>`;
}

function renderCertification() {
  const cards = $('#certification-cards');
  if (!cards) return;
  cards.innerHTML = ['classic','plus','island'].map(type => {
    const count = countCertifiedPeaks(type);
    const goal = certificationGoals[type];
    const percent = Math.min(100, Math.round(count / goal * 100));
    return `<button type="button" class="certification-count${count >= goal ? ' is-complete' : ''}" data-certification-list="${type}" aria-controls="bac-progress" aria-label="${certificationTypes[type]} ${count} / ${goal}좌, 완료 목록 열기">
      <span class="certification-label">${certificationTypes[type]}${count >= goal ? '<span class="completion-badge">완등</span>' : ''}</span>
      <strong>${count}<small> / ${goal}좌</small></strong>
      ${summitMeter(percent, type)}
      <span class="summit-left">${count >= goal ? '모든 인증지 완등!' : '정상까지 '+(goal - count)+'좌'}</span></button>`;
  }).join('');
}

function render() {
  renderCertification();
  renderBacProgress();
  renderHikeSearch();
  updateScheduleShare();
  renderAccountBanner();
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

function hikeMetric(value, unit) {
  return value != null && value !== '' ? value+' '+unit : '';
}

function actualHikeMetrics(record) {
  const track = hikeHasTrack(record.hikeTrack) ? record.hikeTrack : null;
  const minutes = track?.minutes;
  let duration = '';
  if (Number.isFinite(minutes) && minutes > 0) {
    const hours = Math.floor(minutes / 60);
    duration = [hours && hours+'시간', minutes % 60 && minutes % 60+'분'].filter(Boolean).join(' ');
  }
  return {
    distance:hikeMetric(record.actualDistance === '' ? track?.km : record.actualDistance ?? track?.km, 'km'),
    time:record.actualTime || (duration && duration+' (GPX 경과 시간)'),
    ascent:hikeMetric(record.actualAscent === '' ? track?.ascent : record.actualAscent ?? track?.ascent, 'm')
  };
}

function actualHikeSummary(record) {
  const {distance, time, ascent} = actualHikeMetrics(record);
  return [distance, time, ascent && '상승 '+ascent].filter(Boolean).join(' · ');
}

function hikeComparison(record) {
  const actual = actualHikeMetrics(record);
  const rows = [
    ['거리', hikeMetric(record.distance, 'km'), actual.distance],
    ['시간', record.estimatedTime, actual.time],
    ['누적 상승', hikeMetric(record.plannedAscent, 'm'), actual.ascent]
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

function searchHikeSchedules(query, status) {
  const terms = query.trim().split(/\s+/).map(bacKey).filter(Boolean);
  if (!terms.length) return [];
  return records.filter(record => {
    if (!isHike(categoryOf(record)) || !['planned','done'].includes(record.status) || (status && record.status !== status)) return false;
    const keywords = bacKey([record.name, record.region, record.trailhead, record.summit, record.waypoints,
      record.trailEnd, record.actualRoute, record.peakNames, ...(record.certified || [])].filter(Boolean).join(' '));
    return terms.every(term => keywords.includes(term));
  }).sort((a, b) => {
    if (a.status !== b.status) return a.status === 'planned' ? -1 : 1;
    if (!a.start || !b.start) return Number(!a.start) - Number(!b.start);
    return a.status === 'planned' ? a.start.localeCompare(b.start) : b.start.localeCompare(a.start);
  });
}

function renderHikeSearch() {
  const panel = $('#hike-search');
  if (!panel) return;
  panel.hidden = menu !== 'hike' || showingHikeFeed;
  if (panel.hidden) return;
  const query = $('#hike-search-query').value;
  const results = $('#hike-search-results');
  const count = $('#hike-search-count');
  const status = $('#hike-search-status').value;
  count.textContent = '';
  results.replaceChildren();
  if (!bacKey(query)) return;
  if (account && !cloudReady) {
    count.textContent = $('#sync-status').textContent;
    return;
  }
  const found = searchHikeSchedules(query, status);
  count.textContent = found.length ? '검색 결과 '+found.length+'건' : '일치하는 산행 일정이 없어요.';
  results.innerHTML = found.map(record => scheduleCard(record, record.status)).join('');
}

function albumCover(record, photos) {
  if (!photos.length) return '';
  return '<button type="button" class="album-cover" data-album-record="'+escape(record.id)+'" aria-label="'+escape(record.name)+' 사진 '+photos.length+'장 보기">'+
    '<img src="'+photos[0]+'" alt="" loading="lazy" decoding="async"><span>사진 '+photos.length+'장</span></button>';
}

function openPhotoAlbum(photos, title, initial = 0) {
  const viewer = $('#photo-album');
  if (!photos.length || !viewer) return;
  let index = initial;
  let touchStart;
  const image = $('#photo-album-image');
  const previous = $('#photo-album-prev');
  const next = $('#photo-album-next');
  const show = () => {
    image.src = photos[index];
    image.alt = '산행 사진 '+(index+1);
    $('#photo-album-count').textContent = (index+1)+' / '+photos.length;
  };
  const move = offset => {
    index = (index + offset + photos.length) % photos.length;
    show();
  };
  $('#photo-album-title').textContent = title || '산행 사진';
  previous.hidden = next.hidden = photos.length < 2;
  previous.onclick = () => move(-1);
  next.onclick = () => move(1);
  viewer.onkeydown = event => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      move(event.key === 'ArrowLeft' ? -1 : 1);
    }
  };
  image.ontouchstart = event => { touchStart = event.touches[0].clientX; };
  image.ontouchend = event => {
    const delta = event.changedTouches[0].clientX - touchStart;
    if (Math.abs(delta) > 40) move(delta < 0 ? 1 : -1);
    touchStart = undefined;
  };
  image.ontouchcancel = () => { touchStart = undefined; };
  $('#photo-album-close').onclick = () => viewer.close();
  viewer.onclose = () => image.removeAttribute('src');
  show();
  viewer.showModal();
}

function renderHikeFeed() {
  const posts = account && cloudReady ? records.filter(record => record.status === 'done' &&
    isHike(categoryOf(record)) && (savedHikePhotos(record).length || hikeHasTrack(record.hikeTrack))).sort((first, second) =>
      (second.start || '').localeCompare(first.start || '') || (second.end || '').localeCompare(first.end || '')) : [];
  const message = $('#hike-feed-message');
  const loading = account && !cloudReady;
  message.hidden = !loading;
  message.textContent = loading ? $('#sync-status').textContent : '';
  renderHikeFeedIntro(loading || posts.length ? '' : account ? 'empty' : 'guest');
  $('#hike-feed-cards').innerHTML = posts.map(record => {
    const photos = savedHikePhotos(record);
    const summary = actualHikeSummary(record);
    return `<div class="album-card">${albumCover(record, photos)}
    <button type="button" class="hike-feed-card" data-record="${escape(record.id)}">

      <span class="hike-feed-card-body">
        <strong>${escape(record.name)}</strong>

        <span>${escape(scheduleDate(record, true))}</span>
        ${summary ? '<span class="hike-card-metrics">'+escape(summary)+'</span>' : ''}
      </span>
      ${isCompletedCertification(record) ? pandaStamp(record, 'feed') : ''}
      ${hikeTrackPreview(record.hikeTrack)}
    </button></div>`;
  }).join('');
}

const feedSteps = [
  ['완료한 산행 열기','산행이나 백패킹 일정을 완료 처리해요.'],
  ['사진·GPX 저장','사진은 5장까지, GPX를 넣으면 경로와 고도 그래프가 그려져요.'],
  ['앨범으로 모아보기','다녀온 산이 최신순 카드로 쌓이고 사진을 넘겨볼 수 있어요.']
];

function renderHikeFeedIntro(mode) {
  const intro = $('#hike-feed-intro');
  if (!intro) return;
  intro.hidden = !mode;
  if (!mode) {
    intro.replaceChildren();
    return;
  }
  const steps = '<ol class="feed-steps">'+feedSteps.map(([title, text]) =>
    '<li><strong>'+title+'</strong><span>'+text+'</span></li>').join('')+'</ol>';
  const sample = `<figure class="feed-sample" aria-label="산행 피드 카드 예시">
    <span class="feed-sample-badge">예시</span>
    <img src="crew-hike.jpeg" alt="" loading="lazy" width="320" height="200">
    <figcaption><strong>치악산 비로봉</strong><span>2026. 10. 18. (토)</span>
    <span class="hike-card-metrics">12.4km · 5시간 20분 · 상승 1,050m</span>
    <svg class="feed-sample-chart" viewBox="0 0 200 40" aria-hidden="true"><path d="M0 36 L20 30 L45 26 L70 14 L95 6 L120 12 L145 22 L170 28 L200 34" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/></svg></figcaption>
  </figure>`;
  intro.innerHTML = mode === 'guest'
    ? `<div class="feed-intro-copy"><p class="feed-intro-lead">다녀온 산행을 사진과 경로로 남기는 나만의 산행 앨범이에요.</p>${steps}
       <div class="feed-intro-actions"><button type="button" class="primary" data-feed-login${sync ? '' : ' disabled'}>Google로 로그인하고 시작하기</button></div>
       <p class="hint">로그인하면 휴대폰과 PC에서 같은 앨범을 볼 수 있어요.</p></div>${sample}`
    : `<div class="feed-intro-copy"><p class="feed-intro-lead">아직 앨범에 올라온 산행이 없어요.</p>${steps}
       <div class="feed-intro-actions"><button type="button" class="primary" data-feed-done>완료한 산행 보러 가기</button><button type="button" data-add-schedule>＋ 새 일정</button></div></div>${sample}`;
}

function renderAccountBanner() {
  const banner = $('#account-banner');
  if (!banner) return;
  let dismissed = false;
  try { dismissed = localStorage.getItem(bannerKey) === '1'; } catch {}
  banner.hidden = Boolean(account) || !sync || dismissed || showingHikeFeed || !navigator.onLine;
}
const bannerKey = 'oreunaerim:account-banner-dismissed';

function dDayLabel(record) {
  const day = date => Date.UTC(...date.split('-').map((part, index) => Number(part) - (index === 1 ? 1 : 0)));
  const diff = Math.round((day(record.start) - day(today)) / 86400000);
  if (diff < 0) return '진행 중';
  return diff === 0 ? 'D-DAY' : 'D-'+diff;
}

function icsText(value) {
  return String(value ?? '').replace(/\\/g,'\\\\').replace(/;/g,'\\;').replace(/,/g,'\\,').replace(/\r?\n/g,'\\n');
}

function icsFold(line) {
  const parts = [];
  let current = '';
  for (const char of line) {
    if (new TextEncoder().encode(current+char).length > 73) {
      parts.push(current);
      current = ' ';
    }
    current += char;
  }
  return parts.concat(current).join('\r\n');
}

function scheduleIcs(record) {
  const compact = date => date.replaceAll('-','');
  const next = new Date(Date.UTC(...(record.end || record.start).split('-').map((part, index) => Number(part) - (index === 1 ? 1 : 0))) + 86400000);
  const end = next.toISOString().slice(0,10);
  const category = categoryOf(record);
  const meetup = [record.meetingTime && '집결 '+record.meetingTime, record.meetingPlace].filter(Boolean).join(' · ');
  const course = [record.trailhead, record.summit, record.trailEnd].filter(Boolean).join(' → ');
  const description = [categories[category], meetup, course && '코스 '+course, isHike(category) && hikingMetrics(record),
    record.host && '벙주 '+record.host, record.notice].filter(Boolean).join('\n');
  const stamp = new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d+/,'');
  return ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Oreunaerim//Calendar//KO','CALSCALE:GREGORIAN','METHOD:PUBLISH',
    'BEGIN:VEVENT','UID:'+record.id+'@oreunaerim-calendar','DTSTAMP:'+stamp,
    'DTSTART;VALUE=DATE:'+compact(record.start),'DTEND;VALUE=DATE:'+compact(end),
    'SUMMARY:'+icsText((isHike(category) ? '⛰ ' : '')+record.name),
    record.meetingPlace || record.region ? 'LOCATION:'+icsText(record.meetingPlace || record.region) : '',
    description ? 'DESCRIPTION:'+icsText(description) : '',
    record.mapUrl && /^https?:/i.test(record.mapUrl) ? 'URL:'+record.mapUrl : '',
    'BEGIN:VALARM','ACTION:DISPLAY','DESCRIPTION:'+icsText(record.name+' 하루 전이에요'),'TRIGGER:-PT15H','END:VALARM',
    'END:VEVENT','END:VCALENDAR'].filter(Boolean).map(icsFold).join('\r\n')+'\r\n';
}

function exportScheduleIcs() {
  const record = records.find(item => item.id === editing.id);
  if (!record?.start) {
    feedback('캘린더 앱에 추가하려면 시작 날짜를 입력하고 저장해 주세요.');
    return;
  }
  const url = URL.createObjectURL(new Blob([scheduleIcs(record)],{type:'text/calendar;charset=utf-8'}));
  const link = document.createElement('a');
  link.href = url;
  link.download = (record.name.replace(/[\\/:*?"<>|]/g,'').trim() || '오르내림-일정')+'.ics';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url),1000);
  feedback('일정 파일을 받았어요. 파일을 열면 캘린더 앱에 추가돼요.');
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
  const summary = isHike(category) && record.status === 'done' ? actualHikeSummary(record) : '';
  const stamped = status === 'certified';
  const card = `<button class="schedule-card card kind-${kind}${stamped ? ' is-stamped' : ''}" type="button" data-record="${escape(record.id)}">
    <span class="schedule-date">${escape(scheduleDate(record, displayView !== 'month'))}</span>
    <span class="schedule-card-body">
      <span class="schedule-card-head"><strong class="card-title">${escape(title)}</strong>${stamped ? '' : `<span class="schedule-status status-${status}">${statusLabel}</span>`}</span>
      <span class="schedule-tags">${calendarDot(kind)}${escape(labels.join(' · '))}</span>
      ${summary ? '<span class="hike-card-metrics">'+escape(summary)+'</span>' :
        isHike(category) && record.status !== 'done' && hikingMetrics(record) ? '<span class="meta">'+escape(hikingMetrics(record))+'</span>' : ''}
      ${details.length ? '<span class="meta">'+escape(details.join(' · '))+'</span>' : ''}
    </span>
    ${stamped ? pandaStamp(record) : ''}
  </button>`;
  const photos = record.status === 'done' && isHike(category) ? savedHikePhotos(record) : [];
  return photos.length ? `<div class="album-card">${albumCover(record, photos)}${card}</div>` : card;
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
  container.innerHTML = upcoming ? '<span class="d-day">'+dDayLabel(upcoming)+'</span>'+scheduleCard(upcoming, 'planned')+
    '<p class="weather-line" id="upcoming-weather" hidden></p>' : '<p class="upcoming-empty">다가오는 일정이 없어요.</p>';
  if (upcoming) showWeather($('#upcoming-weather'), upcoming);
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
  $('#events').innerHTML = `<div class="events-head"><h3>${selectedDay ? fmt(selectedDay) + ' 일정' : '이달의 일정'}</h3>${selectedDay ?
    `<button type="button" data-add-on-day="${selectedDay}">＋ 이 날 일정 만들기</button>` : '<span class="hint">날짜를 길게 누르면 바로 만들 수 있어요</span>'}</div>` +
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
    hikePhotos = savedHikePhotos(record);
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
  if ($('#share-schedule')) $('#share-schedule').hidden = !record.id;
  if ($('#export-ics')) $('#export-ics').hidden = !record.id || !record.start;
  if ($('#duplicate-schedule')) $('#duplicate-schedule').hidden = !record.id;
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
  if ($('#hike-photo')) $('#hike-photo').disabled = !hike || photoLoading || hikePhotos.length >= hikePhotoLimit;
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
  const gallery = $('#hike-photo-gallery');
  gallery.innerHTML = hikePhotos.map((photo, index) =>
    `<figure><button type="button" class="album-preview" data-preview-photo="${index}" aria-label="사진 ${index+1} 크게 보기"><img src="${escape(photo)}" alt="" loading="lazy" decoding="async"></button><figcaption><button type="button" data-cover-photo="${index}" ${index === 0 || photoLoading ? 'disabled' : ''}>${index === 0 ? '대표 사진' : '대표로 설정'}</button><button type="button" data-remove-photo="${index}" aria-label="사진 ${index+1} 제거" ${photoLoading ? 'disabled' : ''}>제거</button></figcaption></figure>`).join('');
  gallery.hidden = !hikePhotos.length;
  $('#hike-photo-count').textContent = `${hikePhotos.length} / ${hikePhotoLimit}장`;
  $('#hike-photo').disabled = !isHike(field('category').value) || photoLoading || hikePhotos.length >= hikePhotoLimit;
  $('#hike-photo-status').textContent = message;
}

async function compressHikePhoto(file) {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    for (const [maxSide, quality] of [[640, .64], [640, .40], [480, .40], [320, .36]]) {
      const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const photo = canvas.toDataURL('image/jpeg', quality);
      if (photo.length <= 100000 && validHikePhoto(photo)) return photo;
    }
    throw new Error('Photo could not be compressed');
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function loadHikePhoto(event) {
  const input = event.currentTarget;
  const files = Array.from(input.files);
  input.value = '';
  if (!files.length || photoLoading || hikePhotos.length >= hikePhotoLimit) return;
  const request = ++photoRequest;
  const selection = files.slice(0, hikePhotoLimit - hikePhotos.length);
  let added = 0;
  photoLoading = true;
  renderHikePhoto('사진 불러오는 중…');
  for (const file of selection) {
    let photo;
    try { photo = await compressHikePhoto(file); } catch { /* Other selected photos can still be added. */ }
    if (request !== photoRequest || !dialog.open) return;
    if (photo) {
      hikePhotos.push(photo);
      added++;
    }
  }
  photoLoading = false;
  renderHikePhoto([
    added ? `${added}장을 첨부했어요. 일정에서 저장하면 사진이 남아요.` : '',
    added < selection.length ? `${selection.length-added}장을 열지 못했어요. JPG나 PNG로 다시 시도해 주세요.` : '',
    selection.length < files.length ? `최대 ${hikePhotoLimit}장까지 첨부할 수 있어요.` : ''
  ].filter(Boolean).join(' '));
}

function initHikePhotos() {
  const input = $('#hike-photo');
  if (!$('#hike-photo-gallery')) {
    $('#hike-photo-preview').outerHTML = '<p class="hint" id="hike-photo-count"></p><div class="hike-photo-gallery" id="hike-photo-gallery" hidden></div>';
    $('#remove-hike-photo').remove();
  }
  input.multiple = true;
  input.onchange = loadHikePhoto;
  $('#hike-photo-gallery').onclick = event => {
    const preview = event.target.closest('[data-preview-photo]');
    if (preview) {
      openPhotoAlbum([...hikePhotos], field('name').value, Number(preview.dataset.previewPhoto));
      return;
    }
    const cover = event.target.closest('[data-cover-photo]');
    if (cover && !photoLoading) {
      const [photo] = hikePhotos.splice(Number(cover.dataset.coverPhoto), 1);
      hikePhotos.unshift(photo);
      renderHikePhoto('대표 사진을 골랐어요. 일정을 저장하면 반영돼요.');
      $('#hike-photo-gallery [data-preview-photo="0"]').focus();
      return;
    }
    const button = event.target.closest('[data-remove-photo]');
    if (!button || photoLoading) return;
    const index = Number(button.dataset.removePhoto);
    hikePhotos.splice(index, 1);
    renderHikePhoto('사진을 제거했어요. 일정에서 저장하면 반영돼요.');
    $('#hike-photo-gallery').querySelector(`[data-remove-photo="${Math.min(index, hikePhotos.length-1)}"]`)?.focus();
    if (!hikePhotos.length) input.focus();
  };
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
  if ($('#hike-photo')) {
    record.hikePhoto = hikePhotos[0] || '';
    record.hikeExtraPhotos = hikePhotos.slice(1);
  }
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
    showEditorError(uid && !navigator.onLine ? '오프라인에서는 계정 일정을 고칠 수 없어요. 인터넷에 연결되면 다시 저장해 주세요.' :
      uid ? '계정에 저장할 수 없어요. 연결 상태를 확인한 뒤 다시 저장해 주세요.' : '브라우저에서 저장할 수 없어요. 저장 공간이나 브라우저 설정을 확인해 주세요.');
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
  const album = event.target.closest('[data-album-record]');
  if (album) {
    const record = records.find(item => item.id === album.dataset.albumRecord);
    if (record) openPhotoAlbum(savedHikePhotos(record), record.name);
    return;
  }
  if (event.target.closest('[data-add-schedule]')) {
    openEditor();
    return;
  }
  if (event.target.closest('[data-feed-login], #account-banner-login')) {
    loginWithBrowserHelp().then(() => {
      const help = $('#calendar-login-help');
      if (help && !help.hidden) help.scrollIntoView({behavior:'smooth', block:'center'});
    });
    return;
  }
  if (event.target.closest('[data-feed-done]')) {
    $('[data-menu="hike"]').click();
    $('[data-view="done"]').click();
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
  initHikePhotos();
  $('#build-hike-notice').onclick = buildHikeNotice;
  $('#copy-hike-notice').onclick = () => copyHikeNotice();
}
if ($('#bac-search')) initBacPicker();
if ($('#bac-progress')) initBacProgress();
if ($('#hike-search')) {
  $('#hike-search-query').oninput = renderHikeSearch;
  $('#hike-search-status').onchange = renderHikeSearch;
}
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
  renderHikeOverview();
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
if ($('#export-ics')) $('#export-ics').onclick = exportScheduleIcs;
if ($('#account-banner-close')) $('#account-banner-close').onclick = () => {
  try { localStorage.setItem(bannerKey, '1'); } catch {}
  $('#account-banner').hidden = true;
  feedback('하단의 Google로 로그인 버튼으로 언제든 로그인할 수 있어요.');
};
$('#complete').onclick = () => save(editing.status === 'done' ? 'planned' : 'done');
form.addEventListener('invalid', event => {
  const details = event.target.closest('details');
  if (details) details.open = true;
},true);
form.onsubmit = event => {
  event.preventDefault();
  save();
};
/* ---- 편의 기능: 길게 눌러 만들기, 복제, 준비물 세트, 날씨·일출, 다크 모드, 설치 안내 ---- */

let pressTimer = 0;
let pressedDay = '';
function createOnDay(date) {
  selectedDay = date;
  renderCalendar();
  openEditor();
}
$('#calendar').addEventListener('pointerdown', event => {
  const day = event.target.closest('[data-day]');
  if (!day || event.button > 0) return;
  clearTimeout(pressTimer);
  pressedDay = '';
  pressTimer = setTimeout(() => {
    pressedDay = day.dataset.day;
    navigator.vibrate?.(15);
    createOnDay(day.dataset.day);
  }, 550);
});
for (const type of ['pointerup','pointerleave','pointercancel','scroll']) {
  $('#calendar').addEventListener(type, () => clearTimeout(pressTimer), {passive:true});
}
$('#calendar').addEventListener('contextmenu', event => {
  if (event.target.closest('[data-day]')) event.preventDefault();
});
$('#calendar').addEventListener('click', event => {
  if (!pressedDay) return;
  pressedDay = '';
  event.stopImmediatePropagation();
}, true);
$('#calendar').addEventListener('dblclick', event => {
  const day = event.target.closest('[data-day]');
  if (day) createOnDay(day.dataset.day);
});
$('#events').addEventListener('click', event => {
  const add = event.target.closest('[data-add-on-day]');
  if (add) createOnDay(add.dataset.addOnDay);
});

const copyExcluded = new Set(['id','start','end','status','certified','hikePhoto','hikeExtraPhotos','hikeTrack','hikePins',
  'actualTime','actualDistance','actualAscent','actualRoute','deleted']);
function duplicateSchedule() {
  const saved = records.find(record => record.id === editing.id);
  if (!saved) return;
  const copy = {...blank(), ...structuredClone(Object.fromEntries(Object.entries(saved).filter(([name]) => !copyExcluded.has(name))))};
  copy.gear = (copy.gear || []).map(item => ({label:item.label, checked:false}));
  copy.certified = [];
  copy.status = 'planned';
  dialog.close();
  openEditor(copy);
  $('#editor-title').textContent = '복제한 새 일정';
  feedback('코스·집결·준비물을 복사했어요. 날짜를 정하고 저장해 주세요.');
  field('start').focus();
}

const gearPresets = {
  day: ['등산화','식수','보조배터리','행동식','바람막이','스틱','모자','선크림'],
  winter: ['아이젠','스패츠','보온병','다운 재킷','방한 장갑','넥워머','핫팩','헤드랜턴'],
  backpacking: ['텐트','침낭','매트','버너·가스','코펠','헤드랜턴','물·정수 필터','쓰레기봉투'],
  safety: ['구급약','호루라기','비상식','은박 담요','신분증']
};
const builtInGearSets = [['day','당일치기'],['winter','겨울 산행'],['backpacking','백패킹'],['safety','비상용품']];
const gearLabelKey = label => label.replace(/\s/g,'');
function addGearItems(labels, setName) {
  const existing = new Set(gear.map(item => gearLabelKey(item.label)));
  const added = labels.filter(label => !existing.has(gearLabelKey(label)));
  gear.push(...added.map(label => ({label, checked:false})));
  renderGear();
  feedback(added.length ? `'${setName}'에서 준비물 ${added.length}개를 추가했어요.` : `'${setName}' 준비물이 이미 모두 들어 있어요.`);
}
function addGearPreset(name) {
  addGearItems(gearPresets[name], builtInGearSets.find(([id]) => id === name)?.[1] || '세트');
}

/* ---- 내 준비물 세트 ---- */
const gearSetKey = 'oreunaerim:gear-sets:v1';
const gearSetLimit = 20;
const gearSetItemLimit = 60;
let gearSets = [];
let stopGearSets;
let cloudGearSets = false;
try {
  const saved = JSON.parse(localStorage.getItem(gearSetKey) || '[]');
  if (Array.isArray(saved)) gearSets = saved.filter(validGearSet);
} catch {}

function validGearSet(set) {
  return Boolean(set) && typeof set.id === 'string' && typeof set.updatedAt === 'number' &&
    (set.deleted === true || (typeof set.name === 'string' && Array.isArray(set.items)));
}
const liveGearSets = () => gearSets.filter(set => !set.deleted).sort((a, b) => a.name.localeCompare(b.name, 'ko'));

function mergeGearSets(...lists) {
  const byId = new Map();
  for (const set of lists.flat().filter(validGearSet)) {
    const current = byId.get(set.id);
    if (!current || set.updatedAt > current.updatedAt) byId.set(set.id, set);
  }
  return [...byId.values()];
}
const gearSetsSignature = sets => JSON.stringify([...sets].sort((a, b) => a.id.localeCompare(b.id)));

function persistGearSets() {
  try { localStorage.setItem(gearSetKey, JSON.stringify(gearSets)); } catch {}
  if (account && sync?.saveGearSets && cloudGearSets && navigator.onLine) {
    sync.saveGearSets(account.uid, gearSets).catch(() => { cloudGearSets = false; renderGearSets(); });
  }
  renderGearSets();
}

function watchGearSets(user) {
  stopGearSets?.();
  stopGearSets = null;
  cloudGearSets = false;
  if (!user || !sync?.observeGearSets) return;
  stopGearSets = sync.observeGearSets(user.uid, cloudSets => {
    if (account?.uid !== user.uid) return;
    cloudGearSets = true;
    const valid = cloudSets.filter(validGearSet);
    const merged = mergeGearSets(gearSets, valid);
    const changedCloud = gearSetsSignature(merged) !== gearSetsSignature(valid);
    gearSets = merged;
    try { localStorage.setItem(gearSetKey, JSON.stringify(gearSets)); } catch {}
    renderGearSets();
    if (changedCloud && navigator.onLine) sync.saveGearSets(user.uid, gearSets).catch(() => { cloudGearSets = false; renderGearSets(); });
  }, () => { cloudGearSets = false; renderGearSets(); });
}

function currentGearLabels() {
  return [...new Map(gear.map(item => item.label.trim()).filter(Boolean).map(label => [gearLabelKey(label), label])).values()]
    .slice(0, gearSetItemLimit);
}

function saveGearSet(name) {
  const clean = name.replace(/\s+/g, ' ').trim().slice(0, 30);
  const items = currentGearLabels();
  if (!clean) return '세트 이름을 입력해 주세요.';
  if (!items.length) return '먼저 준비물을 추가해 주세요.';
  const same = liveGearSets().find(set => set.name === clean);
  if (!same && liveGearSets().length >= gearSetLimit) return `내 세트는 ${gearSetLimit}개까지 만들 수 있어요.`;
  const set = {id: same?.id || crypto.randomUUID(), name: clean, items, updatedAt: Date.now()};
  gearSets = [...gearSets.filter(item => item.id !== set.id), set];
  persistGearSets();
  feedback(same ? `'${clean}' 세트를 지금 목록으로 바꿨어요.` : `'${clean}' 세트를 만들었어요. 다른 일정에서도 한 번에 넣을 수 있어요.`);
  return '';
}

function updateGearSet(id, changes) {
  const set = gearSets.find(item => item.id === id && !item.deleted);
  if (!set) return;
  gearSets = [...gearSets.filter(item => item.id !== id), {...set, ...changes, updatedAt: Date.now()}];
  persistGearSets();
}

function deleteGearSet(id) {
  const set = gearSets.find(item => item.id === id && !item.deleted);
  if (!set) return;
  gearSets = [...gearSets.filter(item => item.id !== id), {id, deleted: true, updatedAt: Date.now()}];
  persistGearSets();
  feedback(`'${set.name}' 세트를 지웠어요.`);
}

function renderGearSets() {
  const presets = $('#gear-presets');
  if (!presets) return;
  const mine = liveGearSets();
  presets.innerHTML = '<span class="hint">세트로 추가</span>' +
    builtInGearSets.map(([id, label]) => `<button type="button" data-gear-preset="${id}">${label}</button>`).join('') +
    mine.map(set => `<button type="button" class="my-gear-set" data-gear-set="${escape(set.id)}" title="${escape(set.items.join(', '))}">★ ${escape(set.name)}</button>`).join('');
  if (!$('#gear-set-manager')) return;
  $('#gear-set-count').textContent = mine.length ? `내 세트 관리 (${mine.length})` : '내 세트 만들기';
  $('#gear-set-list').innerHTML = mine.length ? mine.map(set => `<li data-set-id="${escape(set.id)}">
      <div class="gear-set-info"><strong>${escape(set.name)}</strong><span>${escape(set.items.join(' · '))}</span></div>
      <div class="gear-set-actions">
        <button type="button" data-set-action="replace">지금 목록으로 바꾸기</button>
        <button type="button" data-set-action="rename">이름 바꾸기</button>
        <button type="button" data-set-action="delete" class="danger">지우기</button>
      </div></li>`).join('') : '<li class="hint">아직 만든 세트가 없어요. 위 준비물 목록을 원하는 대로 만든 뒤 이름을 붙여 저장해 보세요.</li>';
  $('#gear-set-sync').textContent = !account ? '내 세트는 이 기기에 저장돼요. 로그인하면 계정에도 저장돼요.' :
    cloudGearSets ? '내 세트는 계정에 저장돼서 다른 기기에서도 보여요.' : '내 세트는 이 기기에 저장돼요.';
}

function initGearSets() {
  if (!$('#gear-set-manager')) return;
  const input = $('#gear-set-name');
  const error = $('#gear-set-error');
  const submit = () => {
    error.textContent = saveGearSet(input.value);
    if (!error.textContent) input.value = '';
  };
  $('#gear-set-save').addEventListener('click', submit);
  input.addEventListener('input', () => { error.textContent = ''; });
  dialog.addEventListener('close', () => {
    error.textContent = '';
    input.value = '';
    $('#gear-set-manager').open = false;
    renderGearSets();
  });
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.isComposing) {
      event.preventDefault();
      submit();
    }
  });
  $('#gear-set-list').addEventListener('click', event => {
    const button = event.target.closest('[data-set-action]');
    const id = button?.closest('[data-set-id]')?.dataset.setId;
    const set = gearSets.find(item => item.id === id && !item.deleted);
    if (!set) return;
    const action = button.dataset.setAction;
    if (action === 'replace') {
      const items = currentGearLabels();
      if (!items.length) return feedback('먼저 준비물을 추가해 주세요.');
      updateGearSet(id, {items});
      feedback(`'${set.name}' 세트를 지금 목록으로 바꿨어요.`);
    } else if (action === 'rename') {
      const row = button.closest('li');
      row.querySelector('.gear-set-info').innerHTML = `<input class="gear-set-rename" maxlength="30" value="${escape(set.name)}" aria-label="새 세트 이름">`;
      button.textContent = '이름 저장';
      button.dataset.setAction = 'rename-save';
      row.querySelector('input').focus();
      row.querySelector('input').select();
    } else if (action === 'rename-save') {
      const name = button.closest('li').querySelector('input').value.replace(/\s+/g, ' ').trim().slice(0, 30);
      if (!name) return feedback('세트 이름을 입력해 주세요.');
      if (liveGearSets().some(item => item.name === name && item.id !== id)) return feedback('같은 이름의 세트가 이미 있어요.');
      updateGearSet(id, {name});
      feedback(`세트 이름을 '${name}'(으)로 바꿨어요.`);
    } else if (action === 'delete') {
      button.textContent = '정말 지울까요?';
      button.dataset.setAction = 'delete-confirm';
    } else if (action === 'delete-confirm') {
      deleteGearSet(id);
    }
  });
  renderGearSets();
}

const weatherCodes = [[0,'☀️','맑음'],[2,'🌤️','구름 조금'],[3,'☁️','흐림'],[48,'🌫️','안개'],[57,'🌦️','이슬비'],[67,'🌧️','비'],
  [77,'🌨️','눈'],[82,'🌧️','소나기'],[86,'🌨️','눈 소나기'],[99,'⛈️','뇌우']];
const weatherOf = code => weatherCodes.find(([max]) => code <= max) || weatherCodes.at(-1);
const placeCache = new Map();
const weatherCache = new Map();
const placeKey = 'oreunaerim:places:v1';
try { for (const [name, value] of Object.entries(JSON.parse(localStorage.getItem(placeKey) || '{}'))) placeCache.set(name, value); } catch {}

function placeQueries(record) {
  const clean = value => (value || '').replace(/\(.*?\)/g,' ').replace(/\s+/g,' ').trim();
  const name = clean(names(record.name || '')[0]);
  const region = clean(record.region).split(' ');
  return [...new Set([name, name.split(' ')[0], clean(record.summit), region.at(-1), region.at(-1) && !/[시군구]$/.test(region.at(-1)) ? region.at(-1)+'시' : '',
    region.at(-1) && !/[시군구]$/.test(region.at(-1)) ? region.at(-1)+'군' : ''].filter(value => value && value.length > 1))];
}

async function locateRecord(record) {
  const pin = ['summit','trailhead','trailEnd'].map(id => record.hikePins?.[id]).find(validHikePoint);
  if (pin) return {latitude:pin.lat, longitude:pin.lon};
  for (const query of placeQueries(record)) {
    if (!placeCache.has(query)) {
      const response = await fetch('https://geocoding-api.open-meteo.com/v1/search?count=1&language=ko&countryCode=KR&name='+encodeURIComponent(query));
      if (!response.ok) throw new Error('geocoding');
      const found = (await response.json()).results?.[0];
      placeCache.set(query, found ? {latitude:found.latitude, longitude:found.longitude} : null);
      try { localStorage.setItem(placeKey, JSON.stringify(Object.fromEntries(placeCache))); } catch {}
    }
    if (placeCache.get(query)) return placeCache.get(query);
  }
  return null;
}

function sunTimes({latitude, longitude}, date) {
  const rad = Math.PI / 180;
  const [year, monthIndex, day] = date.split('-').map(Number);
  const julian = Date.UTC(year, monthIndex - 1, day, 12) / 86400000 + 2440587.5;
  const cycle = julian - 2451545 + 0.0008 - longitude / 360;
  const anomaly = (357.5291 + 0.98560028 * cycle) % 360;
  const center = 1.9148 * Math.sin(anomaly * rad) + 0.02 * Math.sin(2 * anomaly * rad) + 0.0003 * Math.sin(3 * anomaly * rad);
  const ecliptic = (anomaly + center + 282.9372) % 360;
  const transit = 2451545 + cycle + 0.0053 * Math.sin(anomaly * rad) - 0.0069 * Math.sin(2 * ecliptic * rad);
  const declination = Math.asin(Math.sin(ecliptic * rad) * Math.sin(23.4397 * rad));
  const hour = Math.acos((Math.sin(-0.833 * rad) - Math.sin(latitude * rad) * Math.sin(declination)) /
    (Math.cos(latitude * rad) * Math.cos(declination))) / rad;
  const clock = value => new Intl.DateTimeFormat('ko-KR', {hour:'2-digit', minute:'2-digit', hour12:false, timeZone:'Asia/Seoul'})
    .format(new Date((value - 2440587.5) * 86400000));
  return {sunrise:clock(transit - hour / 360), sunset:clock(transit + hour / 360)};
}

async function scheduleWeather(record) {
  const place = await locateRecord(record);
  if (!place) return null;
  const sun = sunTimes(place, record.start);
  const days = Math.round((Date.parse(record.start) - Date.parse(today)) / 86400000);
  if (days < 0 || days > 15) return {sun};
  const key = place.latitude.toFixed(2)+','+place.longitude.toFixed(2)+'|'+record.start;
  if (!weatherCache.has(key)) {
    const url = 'https://api.open-meteo.com/v1/forecast?timezone=Asia%2FSeoul&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max'+
      '&latitude='+place.latitude+'&longitude='+place.longitude+'&start_date='+record.start+'&end_date='+record.start;
    weatherCache.set(key, fetch(url).then(response => response.ok ? response.json() : Promise.reject(new Error('weather'))));
  }
  const daily = (await weatherCache.get(key).catch(error => { weatherCache.delete(key); throw error; })).daily;
  return {sun, weather:{code:daily.weather_code[0], min:daily.temperature_2m_min[0], max:daily.temperature_2m_max[0],
    rain:daily.precipitation_probability_max[0], wind:daily.wind_speed_10m_max[0]}};
}

function weatherLine(result) {
  if (!result) return '';
  const parts = [];
  if (result.weather) {
    const [, icon, label] = weatherOf(result.weather.code);
    parts.push('<span class="wx-main"><span aria-hidden="true">'+icon+'</span> '+label+'</span>',
      '<span>'+Math.round(result.weather.min)+'° / '+Math.round(result.weather.max)+'°</span>');
    if (result.weather.rain != null) parts.push('<span>강수 '+result.weather.rain+'%</span>');
    if (result.weather.wind != null) parts.push('<span>바람 '+Math.round(result.weather.wind / 3.6)+'m/s</span>');
  }
  parts.push('<span>일출 '+result.sun.sunrise+'</span>', '<span>일몰 '+result.sun.sunset+'</span>');
  return parts.join('<i aria-hidden="true">·</i>');
}

let weatherRequest = 0;
async function showWeather(target, record) {
  if (!target) return;
  const request = String(++weatherRequest);
  target.dataset.request = request;
  target.hidden = true;
  target.innerHTML = '';
  if (!record?.start || record.status === 'done' || record.start < today || (!isHike(categoryOf(record)) && !record.region)) return;
  try {
    const result = await scheduleWeather(record);
    if (target.dataset.request !== request || !target.isConnected || !result) return;
    target.innerHTML = weatherLine(result) + (result.weather ? '' : '<span class="wx-note">날씨는 15일 전부터 보여요</span>');
    target.hidden = false;
  } catch {}
}

const colorKey = 'oreunaerim:color-scheme';
const systemDark = matchMedia('(prefers-color-scheme: dark)');
function applyColorScheme() {
  let saved = '';
  try { saved = localStorage.getItem(colorKey) || ''; } catch {}
  const dark = saved ? saved === 'dark' : systemDark.matches;
  document.documentElement.dataset.color = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0f1a15' : '#143d35');
  const toggle = $('#color-toggle');
  if (toggle) {
    toggle.setAttribute('aria-pressed', dark);
    toggle.setAttribute('aria-label', dark ? '밝은 화면으로 바꾸기' : '어두운 화면으로 바꾸기');
    toggle.textContent = dark ? '☀️' : '🌙';
  }
}
systemDark.addEventListener('change', applyColorScheme);
$('#color-toggle')?.addEventListener('click', () => {
  const next = document.documentElement.dataset.color === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem(colorKey, next); } catch {}
  applyColorScheme();
});
applyColorScheme();

const installKey = 'oreunaerim:install-dismissed';
let installPrompt = null;
function renderInstallCard() {
  const card = $('#install-card');
  if (!card) return;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const mobile = matchMedia('(pointer: coarse)').matches;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let dismissed = false;
  try { dismissed = localStorage.getItem(installKey) === '1'; } catch {}
  card.hidden = standalone || dismissed || (!installPrompt && !mobile);
  if (card.hidden) return;
  $('#install-action').hidden = !installPrompt;
  $('#install-steps').textContent = installPrompt ? '버튼 한 번이면 홈 화면에 아이콘이 생겨요.' :
    ios ? 'Safari 아래쪽 공유 버튼(□↑)을 누르고 "홈 화면에 추가"를 골라 주세요.' :
    '브라우저 메뉴(⋮)에서 "홈 화면에 추가" 또는 "앱 설치"를 골라 주세요.';
}
addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  installPrompt = event;
  renderInstallCard();
});
addEventListener('appinstalled', () => {
  installPrompt = null;
  try { localStorage.setItem(installKey, '1'); } catch {}
  renderInstallCard();
});
$('#install-action')?.addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice.catch(() => null);
  installPrompt = null;
  renderInstallCard();
});
$('#install-close')?.addEventListener('click', () => {
  try { localStorage.setItem(installKey, '1'); } catch {}
  renderInstallCard();
});
renderInstallCard();

$('#duplicate-schedule')?.addEventListener('click', duplicateSchedule);
$('#gear-presets')?.addEventListener('click', event => {
  const preset = event.target.closest('[data-gear-preset]')?.dataset.gearPreset;
  if (preset) return addGearPreset(preset);
  const id = event.target.closest('[data-gear-set]')?.dataset.gearSet;
  const set = id && gearSets.find(item => item.id === id && !item.deleted);
  if (set) addGearItems(set.items, set.name);
});
initGearSets();

/* ---- 오프라인 ---- */
let showingSavedCopy = false;
function renderOfflineBanner() {
  const banner = $('#offline-banner');
  if (!banner) return;
  const offline = !navigator.onLine;
  banner.hidden = !offline;
  if (!offline) return;
  $('#offline-detail').textContent = account
    ? '마지막으로 동기화한 일정과 코스·준비물을 볼 수 있어요. 수정은 연결되면 할 수 있어요.'
    : '이 기기에 저장된 일정을 그대로 보고 고칠 수 있어요.';
}
addEventListener('online', () => {
  renderOfflineBanner();
  renderAccountBanner();
  if (account && showingSavedCopy) $('#sync-status').textContent = '다시 연결됐어요. 일정을 맞추는 중…';
  feedback('다시 연결됐어요.');
});
addEventListener('offline', () => {
  renderOfflineBanner();
  renderAccountBanner();
  feedback('오프라인이에요. 저장된 일정을 보여 드릴게요.');
});
renderOfflineBanner();
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('./sw.js').then(() => navigator.serviceWorker.ready)
    .then(() => new Promise(resolve => setTimeout(resolve, 5000))).then(async () => {
    // 첫 방문 때는 서비스 워커가 늦게 켜져서 이미 받은 파일이 저장되지 않으므로 직접 저장
    const urls = [location.origin + location.pathname, ...performance.getEntriesByType('resource').map(entry => entry.name)]
      .filter(url => url.startsWith(location.origin + '/') || url.startsWith('https://www.gstatic.com/firebasejs/'))
      .filter(url => !/\/sw\.js(\?|$)/.test(url));
    const cache = await caches.open('oreunaerim-offline-v1');
    await Promise.all(urls.map(async url => {
      if (await cache.match(url)) return;
      const response = await fetch(url, {cache:'force-cache'}).catch(() => null);
      if (response?.ok) await cache.put(url, response);
    }));
  }).catch(() => {});
}

initLoginBrowserHelp();
if ($('#schedule-share-dialog')) initScheduleShare();
render();
if (readError) feedback('저장된 기록을 불러올 수 없어 기본 일정을 표시했어요.');

function setSyncBusy(busy) {
  pendingOperation = busy;
  updateScheduleShare();
  for (const button of document.querySelectorAll('#google-login, #google-logout, #import-local, .dialog-actions button')) {
    button.disabled = busy;
  }
}

function changeAccount(user) {
  stopSchedules?.();
  account = user;
  watchGearSets(user);
  renderGearSets();
  if (user) {
    for (const help of document.querySelectorAll('[data-login-help]')) help.hidden = true;
  }
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
  stopSchedules = sync.observeSchedules(user.uid, (incoming, fromCache) => {
    if (account?.uid !== user.uid) return;
    cloudReady = true;
    showingSavedCopy = Boolean(fromCache) && !navigator.onLine;
    records = incoming.filter(record => record.deleted !== true);
    status.textContent = (showingSavedCopy ? '오프라인 · 저장해 둔 일정 보는 중: ' : '동기화 중: ') + (user.email || 'Google 계정');
    renderOfflineBanner();
    try {
      const cloudIds = new Set(incoming.map(record => record.id));
      $('#import-local').hidden = !localRecords().some(record => !cloudIds.has(record.id));
    } catch { $('#import-local').hidden = true; }
    render();
  }, () => {
    cloudReady = false;
    status.textContent = '계정 일정에 연결할 수 없어요.';
    updateScheduleShare();
    if (showingHikeFeed) render();
    else {
      renderBacProgress();
      renderHikeSearch();
    }
  });
}

async function runAccountAction(action, errorMessage) {
  if (pendingOperation) return;
  setSyncBusy(true);
  try { await action(); }
  catch { feedback(errorMessage); }
  finally { setSyncBusy(false); }
}

if ($('#sync-status')) import('./sync.mjs?v=gear-sets').then(module => {
  sync = module;
  updateScheduleShare();
  renderAccountBanner();
  if (showingHikeFeed) renderHikeFeed();
  module.observeAccount(changeAccount);
  $('#google-login').onclick = () => loginWithBrowserHelp();
  $('#google-logout').onclick = () => runAccountAction(module.logout,'로그아웃에 실패했어요. 다시 시도해 주세요.');
  $('#import-local').onclick = () => runAccountAction(async () => {
    if (!account || !cloudReady || !navigator.onLine) throw new Error('Unavailable sync');
    const source = new Map(localRecords().map(record => [record.id,record]));
    await module.importSchedules(account.uid,[...source.values()]);
    feedback('이 브라우저의 일정을 계정으로 가져왔어요.');
  },'일정을 가져오지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요.');
}).catch(() => {
  $('#sync-status').textContent = 'Google 연결을 불러올 수 없어요. 이 브라우저에 저장 중이에요.';
  if (shareMode === 'receive' && sharedSchedule) $('#schedule-share-status').textContent = 'Google 연결을 불러올 수 없어요. 새로고침한 뒤 다시 시도해 주세요.';
});
