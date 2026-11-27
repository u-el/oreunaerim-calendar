import {clubCard,calendarDay,scheduleCard,goalCard} from './moily-components.mjs';
const el=(tag,cls,value)=>{const n=document.createElement(tag);n.className=cls;if(value!=null)n.textContent=value;return n;};
const dateKey=d=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
export function homeSummary(data,now=new Date()){
 const clubs=(data.clubs||[]).filter(c=>c.status==='active'&&c.deletedAt==null).sort((a,b)=>Number(b.isPrimary===true)-Number(a.isPrimary===true)||(Number(a.sortOrder)||0)-(Number(b.sortOrder)||0)||a.id.localeCompare(b.id));
 const ids=new Set(clubs.map(c=>c.id)),today=dateKey(now),month=today.slice(0,7);
 const records=(data.schedules||[]).filter(s=>s.deletedAt==null&&ids.has(s.clubId)&&['planned','completed'].includes(s.status)&&typeof s.startDate==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s.startDate));
 return {clubs,records,monthly:records.filter(s=>s.startDate.startsWith(month)).length,upcoming:records.filter(s=>s.status==='planned'&&(s.endDate||s.startDate)>=today)};
}
export function renderHome(data,templates,layout){
 const root=el('div','moily-home'),summary=homeSummary(data),ready=Array.isArray(data.clubs)&&Array.isArray(data.schedules);
 const hero=el('section','moily-panel moily-stack home-hero');
 hero.append(el('p','moily-caption',(data.profile?.nickname||'회원')+'님, 안녕하세요!'),el('h2','moily-heading','함께하는 오늘,\n설레는 내일.'),el('p','moily-caption','이번 달 모임'),el('p','moily-number',data.error?'확인 필요':ready?summary.monthly+'개':'확인 중…'));
 
 const section=el('section','home-clubs');section.append(el('h2','moily-card-title','내 동호회'));
 if(data.error)section.append(el('p','moily-caption','일부 데이터를 불러오지 못했어요. 새로고침해 주세요.'));
 if(!Array.isArray(data.clubs))section.append(el('p','moily-caption','동호회 확인 중…'));
 else if(!summary.clubs.length){const empty=el('div','moily-panel moily-stack');empty.append(el('p','','아직 등록된 동호회가 없어요.'),el('p','moily-caption','동호회 등록 기능은 다음 개발 단계에서 제공됩니다.'));section.append(empty);}
 else{const others=el('div','home-other-clubs');summary.clubs.forEach((c,i)=>{
 const count=summary.upcoming.filter(s=>s.clubId===c.id).length;
 const card=clubCard({type:i===0?(c.isPrimary?'대표 동호회':'내 동호회'):(Object.hasOwn(templates,c.category)?templates[c.category].label:'기타'),title:c.name,summary:(ready&&!data.error?'예정 일정 '+count+'개':'일정 확인 중…')+' · 바로가기'});
 const link=el('a','home-club-link');link.href='#clubs';link.setAttribute('aria-label',c.name+' · 동호회 메뉴');link.append(card);
 if(i===0){card.classList.add('home-featured');section.append(link);}else others.append(link);
 });if(others.childElementCount)section.append(others);}
 const cards={hero,clubs:section,calendar:homeCalendar(data,summary),upcoming:homeUpcoming(data,summary),goals:homeGoals(data)};
 const h=layout?.homeLayout,order=[...new Set([...(h?.order||[]),...Object.keys(cards)])].filter(k=>Object.hasOwn(cards,k));
 root.dataset.cardSize=['compact','standard','large'].includes(h?.cardSize)?h.cardSize:'standard';
 for(const key of order){if(!h?.hidden?.includes(key)){cards[key].dataset.homeCard=key;root.append(cards[key]);}}
 if(!root.childElementCount)root.append(el('p','moily-panel','모든 홈 카드가 숨겨져 있어요. 레이아웃 설정에서 다시 표시할 수 있어요.'));
 const quick=el('section','moily-panel moily-stack home-quick');quick.append(el('h2','moily-card-title','빠른 등록'));
 const grid=el('div','home-quick-grid');
 for(const [label,route] of [['일정 등록','calendar'],['활동 기록','activity'],['동호회 추가','clubs'],['목표 추가','activity']]){const a=el('a','moily-button moily-button-secondary',label);a.href='#'+route;a.setAttribute('aria-label',label+' 메뉴로 이동 (등록 기능 준비 중)');grid.append(a);}
 quick.append(grid,el('p','moily-caption','등록 기능은 각 메뉴 개발 단계에서 연결됩니다.'));root.append(quick);return root;
}

const weekdays=['일','월','화','수','목','금','토'];
const validDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s);
const dayNumber=s=>Date.parse(s+'T00:00:00Z')/86400000;
const dateLabel=s=>s.slice(5).replace('-','.')+' ('+weekdays[new Date(s+'T00:00:00').getDay()]+')';
const clubName=(summary,s)=>summary.clubs.find(c=>c.id===s.clubId)?.name||'';
const typeName=(data,s)=>(data.activityTypes||[]).find(t=>t.id===s.activityTypeId&&t.clubId===s.clubId)?.name||'';
function homeCalendar(data,summary){
 const panel=el('section','moily-panel moily-stack home-calendar'),now=new Date();
 let month=new Date(now.getFullYear(),now.getMonth(),1),selected=dateKey(now);
 const draw=()=>{
 panel.replaceChildren();
 const head=el('div','home-calendar-head'),title=el('h2','moily-card-title',month.getFullYear()+'년 '+(month.getMonth()+1)+'월');
 for(const delta of [-1,1]){const b=el('button','moily-day',delta<0?'‹':'›');b.type='button';b.setAttribute('aria-label',delta<0?'이전 달':'다음 달');b.onclick=()=>{month=new Date(month.getFullYear(),month.getMonth()+delta,1);selected=dateKey(month);draw();};if(delta<0)head.append(b,title);else head.append(b);}
 const grid=el('div','home-calendar-grid');
 weekdays.forEach(w=>grid.append(el('span','moily-caption',w)));
 for(let i=0;i<month.getDay();i++)grid.append(el('span',''));
 const days=new Date(month.getFullYear(),month.getMonth()+1,0).getDate();
 const matches=key=>summary.records.filter(s=>s.startDate<=key&&(validDate(s.endDate)&&s.endDate>=s.startDate?s.endDate:s.startDate)>=key);
 for(let d=1;d<=days;d++){const key=dateKey(new Date(month.getFullYear(),month.getMonth(),d));const b=calendarDay({date:d,hasEvent:matches(key).length>0,selected:key===selected,onSelect:()=>{selected=key;draw();}});if(key===dateKey(now))b.setAttribute('aria-current','date');grid.append(b);}
 panel.append(head,grid,el('h3','moily-card-title',dateLabel(selected)));
 if(data.error||!Array.isArray(data.schedules)||!Array.isArray(data.clubs))panel.append(el('p','moily-caption','일정 확인 중 또는 조회 실패'));
 else{const list=matches(selected);if(!list.length)panel.append(el('p','moily-caption','등록된 일정이 없어요.'));else list.forEach(s=>panel.append(el('p','',s.title+' · '+clubName(summary,s))));}
 };draw();return panel;
}
function homeUpcoming(data,summary){
 const section=el('section','moily-stack');section.append(el('h2','moily-card-title','다가오는 일정'));
 if(data.error||!Array.isArray(data.schedules)||!Array.isArray(data.clubs)){section.append(el('p','moily-caption','일정 확인 중 또는 조회 실패'));return section;}
 const today=dateKey(new Date()),list=[...summary.upcoming].sort((a,b)=>a.startDate.localeCompare(b.startDate)||a.id.localeCompare(b.id)).slice(0,3);
 if(!list.length)section.append(el('p','moily-panel','다가오는 일정이 없어요.'));
 for(const s of list){const d=dayNumber(s.startDate)-dayNumber(today),label=d<0?'진행 중':d===0?'D-day':'D-'+d;const card=scheduleCard({date:[clubName(summary,s),typeName(data,s)].filter(Boolean).join(' · '),title:s.title,subtitle:dateLabel(s.startDate)+' · '+label+(typeof s.location==='string'?' · '+s.location:''),status:'예정'});section.append(card);}
 return section;
}
function homeGoals(data){
 const section=el('section','moily-stack');section.append(el('h2','moily-card-title','나의 목표'));
 if(data.error||!Array.isArray(data.goals)){section.append(el('p','moily-caption','목표 확인 중 또는 조회 실패'));return section;}
 const goals=data.goals.filter(g=>g.deletedAt==null&&Number.isFinite(g.targetValue)&&g.targetValue>0).sort((a,b)=>Number(b.id===data.preferences?.primaryGoalId)-Number(a.id===data.preferences?.primaryGoalId)||a.id.localeCompare(b.id));
 if(!goals.length)section.append(el('p','moily-panel','아직 등록된 목표가 없어요.'));
 goals.forEach((g,i)=>{const card=el('article','moily-panel moily-stack'+(i===0?' home-goal-featured':''));if(i===0)card.append(el('p','moily-caption',g.id===data.preferences?.primaryGoalId?'대표 목표':'나의 목표'));card.append(el('h3','moily-card-title',g.title),el('p','moily-number','목표 '+g.targetValue+(typeof g.unit==='string'?g.unit:'')),el('p','moily-caption','진행률은 활동 기록 연동 후 표시됩니다.'));section.append(card);});
 return section;
}
