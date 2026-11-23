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
const allFields = ['category','certificationType','name','region','start','end','type','host','people','lodging','overnight','transport','budget','status','memo','notice'];
const fmt = date => date ? date.replaceAll('-', '.') : '날짜 미정';
const iso = (year, month, day) => [year,String(month+1).padStart(2,'0'),String(day).padStart(2,'0')].join('-');
const today = new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date());
let month = new Date(today.slice(0,7)+'-01T00:00:00');
let selectedDay = '';
let view = 'planned';
let menu = 'all';
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

function certifiedPeaks(type) {
  return new Set(records.filter(record => certificationTypeOf(record) === type).flatMap(record => record.certified));
}

function renderCertification() {
  const type = $('#stats-certification-type').value;
  const count = certifiedPeaks(type).size;
  const hasGoal = type !== 'plus';
  const percent = Math.min(100, Math.round(count / goal * 100));
  const progress = hasGoal ? `<div class="bar" aria-hidden="true"><i style="width:${percent}%"></i></div>` : '';
  $('#stats-progress').innerHTML = `<strong>${count}<small>${hasGoal ? ' / '+goal : ''}좌</small></strong>${progress}<span>${hasGoal ? percent+'% 달성' : '완료 인증 기준'}</span>`;
}

$('#stats-certification-type').onchange = renderCertification;

const activityBanners = {
  all: {title:'오르내림, 다음엔 뭐 할까?', description:'같이 오를 산, 같이 먹을 한 끼, 같이 놀러 갈 곳.\n오르내림의 다음 약속을 한눈에 봐요.'},
  hike: {title:'이번엔 어느 산에 오를까?', description:'가볍게 걷는 산행부터 별 아래 백패킹까지, 같이 오를 날을 골라봐요.', mascots:['glasses','hike']},
  food: {title:'오늘은 뭐 먹으러 갈까?', description:'궁금했던 맛집도, 산행 뒤 든든한 한 끼도. 맛있는 약속을 잡아봐요.', mascots:['snack','grill']},
  play: {title:'이번엔 뭐 하고 놀까?', description:'같이 해보고 싶었던 것들을 모아, 신나는 하루를 계획해 봐요.', mascots:['ribbon','picnic']}
};

function renderBanner() {
  const banner = activityBanners[menu];
  $('#hero-title').textContent = banner.title;
  $('#hero-description').textContent = banner.description;
  $('.crew').hidden = menu !== 'all';
  const mascots = $('#hero-mascots');
  mascots.hidden = !banner.mascots;
  if (banner.mascots) {
    mascots.querySelectorAll('img').forEach((image, index) => {
      image.src = 'crew-' + banner.mascots[index] + '.jpeg';
    });
  }
}

function render() {
  renderBanner();
  renderCertification();
  const active = menus[menu];
  document.body.dataset.theme = menu;
  document.querySelectorAll('[data-menu]').forEach(button => {
    button.setAttribute('aria-pressed', button.dataset.menu === menu);
  });
  $('#stats').hidden = menu !== 'hike';
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
  const list = (view === 'certified' ? records.filter(record => record.certified.length) :
    records.filter(record => record.status === view))
    .filter(record => (!filter || record.type === filter) && active.categories.includes(categoryOf(record)) && (!category || categoryOf(record) === category))
    .filter(record => menu !== 'hike' || !certificationFilter.value || certificationTypeOf(record) === certificationFilter.value)
    .sort((a,b) => a.start && b.start ? (view === 'planned' ? a.start.localeCompare(b.start) : b.start.localeCompare(a.start)) : Number(!a.start)-Number(!b.start));
  $('#records').innerHTML = list.map(record => scheduleCard(record, view)).join('') || (view === 'planned' && !filter && !category && (menu !== 'hike' || !certificationFilter.value)
    ? '<div class="empty empty-planner"><img src="crew-ribbon.jpeg" alt="" width="76" height="76"><div><p>첫 벙을 열어볼까요?</p><button type="button" data-add-schedule>＋ 새 일정</button></div></div>'
    : '<p class="empty">표시할 기록이 없어요.</p>');
  renderCalendar();
}

const calendarKindLabels = {hike:'산행',backpacking:'백패킹',food:'먹벙',play:'놀이벙'};
const calendarKind = record => {
  const category = categoryOf(record);
  if (category === 'backpacking' || category === 'food') return category;
  return isHike(category) ? 'hike' : 'play';
};
const calendarDot = kind => `<i class="calendar-dot ${kind}" aria-hidden="true"></i>`;

function scheduleDate(record) {
  if (!record.start) return '날짜 미정';
  const format = date => new Intl.DateTimeFormat('ko-KR', {
    month: 'numeric', day: 'numeric', weekday: 'short', timeZone: 'Asia/Seoul'
  }).format(new Date(date+'T00:00:00+09:00'));
  return format(record.start) + (record.end && record.end !== record.start ? ' ~ '+format(record.end) : '');
}

function scheduleCard(record, displayView) {
  const category = categoryOf(record);
  const kind = calendarKind(record);
  const certification = isHike(category) && certificationTypes[certificationTypeOf(record)];
  const title = displayView === 'certified' ? record.certified.join(' · ') : record.name;
  const labels = [categories[category], record.type, certification === '미정' ? '인증 미정' : certification].filter(Boolean);
  const gear = record.gear || [];
  const meeting = (record.notice || '').split('\n').map(line => line.trim())
    .filter(line => /^(집결(?:\s*(?:장소|시간))?|출발\s*(?:장소|시간))\s*[:：]/.test(line));
  const details = [...meeting, record.region, record.host && '벙주 '+record.host, record.people != null && record.people !== '' && record.people+'명', record.transport, record.overnight !== '숙박 없음' && record.lodging, gear.length && '준비물 '+gear.filter(item => item.checked).length+'/'+gear.length].filter(Boolean);
  return `<button class="schedule-card card kind-${kind}" type="button" data-record="${escape(record.id)}">
    <span class="schedule-date">${escape(scheduleDate(record))}</span>
    <strong class="card-title">${escape(title)}</strong>
    <span class="schedule-tags">${calendarDot(kind)}${escape(labels.join(' · '))}</span>
    ${details.length ? '<span class="meta">'+escape(details.join(' · '))+'</span>' : ''}
  </button>`;
}

function renderUpcoming(categories) {
  const container = $('#upcoming-schedule');
  if (!container) return;
  const upcoming = records.filter(record => record.status === 'planned' && record.start &&
    (record.end || record.start) >= today && categories.includes(categoryOf(record)))
    .sort((first, second) => first.start.localeCompare(second.start))[0];
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
    const firstName = count ? escape(dayRecords[0].name) : '';
    const more = count > 1 ? `<span class="day-more">외 ${count-1}건</span>` : '';
    const summary = count ? `<span class="day-summary"><span class="day-event-name">${firstName}</span>${more}</span>` : '';
    html += `<button class="day ${count ? 'has-event' : ''} ${date === today ? 'today' : ''}" data-day="${date}" aria-pressed="${date === selectedDay}" aria-label="${index+1}월 ${day}일${count ? ', 일정 '+count+'건' : ''}${kindLabels ? '· '+kindLabels+' · '+firstName : ''}">${fills}<span class="day-number">${day}</span>${summary}</button>`;
  }
  $('#calendar').innerHTML = html;
  const events = calendarRecords.filter(record => selectedDay ? includes(record,selectedDay) :
    record.start && record.start <= prefix+'-31' && (record.end || record.start) >= prefix+'-01');
  events.sort((a,b) => a.start.localeCompare(b.start));
  $('#events').innerHTML = `<h3>${selectedDay ? fmt(selectedDay) + ' 일정' : '이달의 일정'}</h3>` +
    (events.map(record => scheduleCard(record, 'calendar')).join('') || '<span class="hint">등록된 일정이 없어요.</span>');
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
  for (const name of allFields) field(name).value = record[name] ?? '';
  field('category').value = categoryOf(record);
  field('certificationType').value = record.id ? certificationTypeOf(record) : $('#certification-filter').value || 'island';
  field('end').setCustomValidity('');
  field('name').setCustomValidity('');
  $('#gear-name').value = '';
  $('#schedule-details').open = false;
  $('#editor-title').textContent = record.id ? '일정 상세' : '새 일정';
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
  renderPeaks();
}

function renderPeaks() {
  $('#peaks').innerHTML = [...new Set(names(field('name').value))].map(name =>
    `<label class="checkrow"><input type="checkbox" value="${escape(name)}" ${checks.has(name) ? 'checked' : ''}> ${escape(name)} 인증 완료</label>`
  ).join('') || '<p class="hint">산 이름을 입력하면 인증 여부를 체크할 수 있어요.</p>';
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

async function save(statusOverride) {
  if (pendingOperation) return;
  const start = field('start').value;
  const end = field('end').value;
  field('end').setCustomValidity(end && (!start || end < start) ? '종료 날짜는 시작 날짜와 같거나 이후여야 해요.' : '');
  const hike = isHike(field('category').value);
  const name = field('name').value.trim();
  field('name').setCustomValidity((hike ? names(name).length : name) ? '' : '일정 이름을 입력해 주세요.');
  if (!form.reportValidity()) return;
  const record = Object.fromEntries(allFields.map(name => [name,field(name).value.trim()]));
  Object.assign(record,{id:editing.id || crypto.randomUUID(),gear,certified:hike ? [...new Set(names(record.name))].filter(name => checks.has(name)) : []});
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
    form.querySelector('.save-error')?.remove();
    const error = document.createElement('p');
    error.className = 'save-error';
    error.setAttribute('role','alert');
    error.textContent = uid ? '계정에 저장할 수 없어요. 연결 상태를 확인한 뒤 다시 저장해 주세요.' : '브라우저에서 저장할 수 없어요. 저장 공간이나 브라우저 설정을 확인해 주세요.';
    $('.dialog-actions').before(error);
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
  view = record.status === 'planned' ? 'planned' : record.certified.length ? 'certified' : 'done';
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
  if (!button || button.dataset.menu === menu) return;
  menu = button.dataset.menu;
  view = 'planned';
  $('#filter').value = '';
  $('#category-filter').value = '';
  $('#certification-filter').value = '';
  render();
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
  if (button) openEditor(records.find(record => record.id === button.dataset.record));
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
$('#complete').onclick = () => save(editing.status === 'done' ? 'planned' : 'done');
form.addEventListener('invalid', event => {
  const details = event.target.closest('#schedule-details');
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
    records = incoming;
    status.textContent = '동기화 중: ' + (user.email || 'Google 계정');
    try {
      const cloudIds = new Set(incoming.map(record => record.id));
      $('#import-local').hidden = !localRecords().some(record => !cloudIds.has(record.id));
    } catch { $('#import-local').hidden = true; }
    render();
  }, () => {
    cloudReady = false;
    status.textContent = '계정 일정에 연결할 수 없어요.';
  });
}

async function runAccountAction(action, errorMessage) {
  if (pendingOperation) return;
  setSyncBusy(true);
  try { await action(); }
  catch { feedback(errorMessage); }
  finally { setSyncBusy(false); }
}

if ($('#sync-status')) import('./sync.mjs').then(module => {
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
