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
const certificationTypes = {classic:'100대 명산',plus:'100플러스 명산',island:'섬앤산'};
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

const form = $('#form');
const dialog = $('#editor');
const field = name => form.elements.namedItem(name);
const allFields = ['category','certificationType','name','region','start','end','type','host','people','lodging','overnight','transport','budget','status','memo','notice'];
const fmt = date => date ? date.replaceAll('-', '.') : '날짜 미정';
const iso = (year, month, day) => [year,String(month+1).padStart(2,'0'),String(day).padStart(2,'0')].join('-');
const today = new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date());
const dateRange = record => fmt(record.start) + (record.end && record.end !== record.start ? ' ~ '+fmt(record.end) : '');
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
  const type = $('#summit-type').value;
  const count = certifiedPeaks(type).size;
  const hasGoal = type !== 'plus';
  const percent = Math.min(100, Math.round(count / goal * 100));
  const progress = hasGoal ? `<div class="bar" aria-hidden="true"><i style="width:${percent}%"></i></div>` : '';
  const note = type === 'classic' ? '' : '<span>완료 인증 기준</span>';
  $('#stats-certification-type').value = type;
  $('#stats-progress').innerHTML = `<strong>${count}<small>${hasGoal ? ' / '+goal : ''}좌</small></strong>${progress}<span>${hasGoal ? percent+'% 달성' : '완료 인증 기준'}</span>`;
  $('#stats-certified-count').innerHTML = `${count}<small> 좌</small>`;
  $('#stats-certified-label').textContent = certificationTypes[type] + ' 인증 기록';
  $('#summit-progress').innerHTML = `<strong>${count}<small>${hasGoal ? ' / '+goal : ''}좌</small></strong>${progress}${note}`;
}

$('#summit-type').onchange = renderCertification;
$('#stats-certification-type').onchange = event => {
  $('#summit-type').value = event.target.value;
  renderCertification();
};

function render() {
  renderCertification();
  const active = menus[menu];
  document.body.dataset.theme = menu;
  document.querySelectorAll('[data-menu]').forEach(button => {
    button.setAttribute('aria-pressed', button.dataset.menu === menu);
  });
  $('.hero').hidden = $('#stats').hidden = $('[data-view="certified"]').hidden = menu !== 'hike' && menu !== 'all';
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
  const planned = records.filter(record => record.status === 'planned');
  $('#stats-planned-count').innerHTML = `${planned.length}<small> 건</small>`;
  document.querySelectorAll('[data-view]').forEach(button => button.setAttribute('aria-pressed',button.dataset.view === view));
  const filter = $('#filter').value;
  const category = $('#category-filter').value;
  const list = (view === 'certified' ? records.filter(record => record.certified.length) :
    records.filter(record => record.status === view))
    .filter(record => (!filter || record.type === filter) && active.categories.includes(categoryOf(record)) && (!category || categoryOf(record) === category))
    .filter(record => menu !== 'hike' || !certificationFilter.value || certificationTypeOf(record) === certificationFilter.value)
    .sort((a,b) => a.start && b.start ? (view === 'planned' ? a.start.localeCompare(b.start) : b.start.localeCompare(a.start)) : Number(!a.start)-Number(!b.start));
  $('#records').innerHTML = list.map(record => {
    const date = (record.start || '').split('-');
    const checked = record.gear.filter(item => item.checked).length;
    const summary = [categories[categoryOf(record)], isHike(categoryOf(record)) ? certificationTypes[certificationTypeOf(record)] : '', record.region || '지역 미정', record.host ? '벙주 '+record.host : '', record.people === '' ? '인원 미정' : record.people+'명', record.overnight === '숙박 없음' ? '' : record.lodging || (record.overnight === '숙박' ? '숙소 미정' : '')].filter(Boolean).join(' · ');
    const title = view === 'certified' ? record.certified.join(' · ') : record.name;
    return `<button class="card" data-record="${escape(record.id)}"><span class="datebox${menu === 'all' && view === 'planned' ? ' '+calendarKind(record) : ''}">${date[0] ? `<span>${escape(date[0])}.${escape(date[1])}</span><strong>${escape(date[2])}</strong>` : '날짜 미정'}</span>
    <span><strong class="card-title">${escape(title)}</strong><span class="meta">${escape(summary)}</span><span class="meta">${escape(dateRange(record))}${record.gear.length ? ' · 준비물 '+checked+'/'+record.gear.length : ''}</span></span>
    <span class="badge ${['1박 2일','2박 3일'].includes(record.type) ? 'night' : ''}">${escape(view === 'certified' ? '인증 완료' : record.type || (record.status === 'done' ? '완료' : '유형 미정'))}</span></button>`;
  }).join('') || '<p class="empty">표시할 기록이 없어요.</p>';
  renderCalendar();
}

const calendarKindLabels = {hike:'산행',backpacking:'백패킹',food:'먹벙',play:'놀이벙'};
const calendarKind = record => {
  const category = categoryOf(record);
  if (category === 'backpacking' || category === 'food') return category;
  return isHike(category) ? 'hike' : 'play';
};
const calendarDot = kind => `<i class="calendar-dot ${kind}" aria-hidden="true"></i>`;

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
    html += `<button class="day ${count ? 'has-event' : ''} ${date === today ? 'today' : ''}" data-day="${date}" aria-pressed="${date === selectedDay}" aria-label="${index+1}월 ${day}일${count ? ', 일정 '+count+'건' : ''}${kindLabels ? ' · '+kindLabels : ''}">${fills}<span class="day-number">${day}</span></button>`;
  }
  $('#calendar').innerHTML = html;
  const events = calendarRecords.filter(record => selectedDay ? includes(record,selectedDay) :
    record.start && record.start <= prefix+'-31' && (record.end || record.start) >= prefix+'-01');
  events.sort((a,b) => a.start.localeCompare(b.start));
  $('#events').innerHTML = `<span class="hint">${selectedDay ? fmt(selectedDay) : '이달의 일정'}</span>` +
    (events.map(record => `<button class="event" data-record="${escape(record.id)}">${calendarDot(calendarKind(record))}${escape(dateRange(record).slice(5))} · ${escape(record.name)} · ${escape(categories[categoryOf(record)])}</button>`).join('') || '<span class="hint">등록된 일정이 없어요.</span>');
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
  $('#editor-title').textContent = record.id ? '일정 상세' : '새 일정';
  $('#complete').hidden = record.status === 'done';
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

function save(forceDone) {
  const start = field('start').value;
  const end = field('end').value;
  field('end').setCustomValidity(end && (!start || end < start) ? '종료 날짜는 시작 날짜와 같거나 이후여야 해요.' : '');
  const hike = isHike(field('category').value);
  const name = field('name').value.trim();
  field('name').setCustomValidity((hike ? names(name).length : name) ? '' : '일정 이름을 입력해 주세요.');
  if (!form.reportValidity()) return;
  const record = Object.fromEntries(allFields.map(name => [name,field(name).value.trim()]));
  Object.assign(record,{id:editing.id || crypto.randomUUID(),gear,certified:hike ? [...new Set(names(record.name))].filter(name => checks.has(name)) : []});
  if (forceDone) record.status = 'done';
  const nextRecords = [...records.filter(item => item.id !== record.id),record];
  try {
    localStorage.setItem(key,JSON.stringify(nextRecords));
  } catch {
    form.querySelector('.save-error')?.remove();
    const error = document.createElement('p');
    error.className = 'save-error';
    error.setAttribute('role','alert');
    error.textContent = '브라우저에서 저장할 수 없어요. 저장 공간이나 브라우저 설정을 확인해 주세요.';
    $('.dialog-actions').before(error);
    return;
  }
  records = nextRecords;
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
  feedback(forceDone ? '일정을 완료 처리했어요.' : '일정을 저장했어요.');
}

$('#export-backup').onclick = () => {
  if (readError) {
    feedback('저장된 기록을 불러올 수 없어 백업할 수 없어요.');
    return;
  }
  const saved = localStorage.getItem(key);
  const backup = JSON.stringify({version:1, records:saved ? JSON.parse(saved) : records},null,2);
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
$('#complete').onclick = () => save(true);
form.onsubmit = event => {
  event.preventDefault();
  save(false);
};
render();
if (readError) feedback('저장된 기록을 불러올 수 없어 기본 일정을 표시했어요.');
