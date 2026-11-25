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
  'actualTime','actualRoute','hikeNotes','peakNames'];
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

function countCertifiedPeaks(type) {
  const regionsByPeak = new Map();
  for (const record of records) {
    if (!isCompletedCertification(record) || certificationTypeOf(record) !== type) continue;
    const region = (record.region || '').normalize('NFC').trim().replace(/\s+/g, ' ');
    for (const peak of record.certified) {
      const name = peak.normalize('NFC').trim();
      if (!name) continue;
      if (!regionsByPeak.has(name)) regionsByPeak.set(name, new Set());
      if (region) regionsByPeak.get(name).add(region);
    }
  }
  // A record without a region does not establish a distinct peak.
  return [...regionsByPeak.values()].reduce((count, regions) => count + Math.max(1, regions.size), 0);
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

function renderHikeFeed() {
  const posts = account && cloudReady ? records.filter(record => record.status === 'done' &&
    isHike(categoryOf(record)) && hasHikePhoto(record)).sort((first, second) =>
      (second.start || '').localeCompare(first.start || '') || (second.end || '').localeCompare(first.end || '')) : [];
  const message = $('#hike-feed-message');
  message.hidden = posts.length > 0;
  message.textContent = !account ? 'Google 계정으로 로그인하면 내 산행 사진을 볼 수 있어요.' :
    !cloudReady ? $('#sync-status').textContent : '완료한 산행이나 백패킹 일정에 사진을 저장하면 여기에 나타나요.';
  $('#hike-feed-cards').innerHTML = posts.map(record => `
    <button type="button" class="hike-feed-card" data-record="${escape(record.id)}">
      <img src="${escape(record.hikePhoto)}" alt="" loading="lazy" decoding="async">
      <span class="hike-feed-card-body">
        <strong>${escape(record.name)}</strong>
        <span>${escape(scheduleDate(record, true))}${record.actualTime ? ' · '+escape(record.actualTime) : ''}</span>
        ${isCompletedCertification(record) ? '<span class="schedule-status status-certified">인증 완료</span>' : ''}
      </span>
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
    renderHikePhoto();
    updateMapLink();
  }
  field('category').value = categoryOf(record);
  field('certificationType').value = record.id ? certificationTypeOf(record) : $('#certification-filter').value || 'island';
  field('end').setCustomValidity('');
  field('name').setCustomValidity('');
  $('#gear-name').value = '';
  $('#schedule-details').open = false;
  $('#editor-title').textContent = record.id ? '일정 상세' : '새 일정';
  const deleteButton = $('#delete-schedule');
  if (deleteButton) deleteButton.hidden = !record.id;
  $('#complete').textContent = record.status === 'done' ? '완료 취소' : '완료 처리';
  renderCategory();
  renderGear();
  dialog.showModal();
}

function renderCategory() {
  const hike = isHike(field('category').value);
  $('#record-name-label').textContent = hike ? '산 이름' : '모임 이름';
  field('name').placeholder = hike ? '예) 가라산' : '예) 연말 저녁 모임';
  $('#certification').hidden = $('#certification-type-field').hidden = !hike;
  $('#category-field').classList.toggle('full-width-field', !hike);
  for (const section of [$('#hike-planning'), $('#hike-log')]) {
    if (!section) continue;
    section.hidden = !hike;
    for (const input of section.querySelectorAll('input, select, textarea')) input.disabled = !hike;
  }
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

function buildHikeNotice() {
  const record = readScheduleFields();
  const route = [record.trailhead, record.waypoints, record.summit, record.trailEnd].filter(Boolean).join(' → ');
  const meetup = [record.meetingTime, record.meetingPlace].filter(Boolean).join(' · ');
  const lines = [
    ['일정', record.start && scheduleDate(record, true)],
    ['지역', record.region], ['집결', meetup], ['지도', mapLink(record.mapUrl)],
    ['코스', route], ['거리·시간·난이도', hikingMetrics(record)],
    ['벙주', record.host], ['인원', record.people && record.people+'명'],
    ['교통', record.transport], ['주차', record.parking], ['차량 회수', record.vehiclePickup],
    ['숙소', record.lodging], ['예산', record.budget && Number(record.budget).toLocaleString('ko-KR')+'원'],
    ['인증', [certificationTypes[record.certificationType], certificationPoints(record).join(' · ')].filter(Boolean).join(' · ')],
    ['준비물', gear.map(item => item.label).filter(Boolean).join(', ')]
  ];
  if (record.category === 'backpacking') lines.push(['야영지', record.campsite], ['예약', record.campBooking], ['물 보급', record.waterSource]);
  $('#hike-notice-text').value = [record.name ? '['+record.name+'] 산행 안내' : '산행 안내',
    ...lines.filter(([,value]) => value).map(([label,value]) => label+': '+value), record.notice].filter(Boolean).join('\n');
  $('#hike-notice-preview').hidden = false;
  $('#hike-notice-status').textContent = '';
  $('#hike-notice-text').focus();
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
  if (photoLoading) {
    showEditorError('사진을 불러오는 중이에요. 잠시 뒤 저장해 주세요.');
    return;
  }
  const record = readScheduleFields();
  if ($('#hike-photo')) record.hikePhoto = hikePhoto;
  Object.assign(record,{id:editing.id || crypto.randomUUID(),gear,certified:hike ? certificationPoints(record).filter(name => checks.has(name)) : []});
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
  if (button.classList.contains('hike-feed-card')) $('#hike-log').open = true;
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
  $('#copy-hike-notice').onclick = async () => {
    const text = $('#hike-notice-text');
    const status = $('#hike-notice-status');
    try {
      await navigator.clipboard.writeText(text.value);
      status.textContent = '공지 초안을 복사했어요.';
    } catch {
      text.focus();
      text.select();
      status.textContent = '선택된 공지 초안을 복사해 주세요.';
    }
  };
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
