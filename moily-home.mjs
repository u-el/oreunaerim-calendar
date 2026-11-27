import {clubCard} from './moily-components.mjs';
const el=(tag,cls,value)=>{const n=document.createElement(tag);n.className=cls;if(value!=null)n.textContent=value;return n;};
const dateKey=d=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
export function homeSummary(data,now=new Date()){
 const clubs=(data.clubs||[]).filter(c=>c.status==='active'&&c.deletedAt==null).sort((a,b)=>Number(b.isPrimary===true)-Number(a.isPrimary===true)||(Number(a.sortOrder)||0)-(Number(b.sortOrder)||0)||a.id.localeCompare(b.id));
 const ids=new Set(clubs.map(c=>c.id)),today=dateKey(now),month=today.slice(0,7);
 const records=(data.schedules||[]).filter(s=>s.deletedAt==null&&ids.has(s.clubId)&&['planned','completed'].includes(s.status)&&typeof s.startDate==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s.startDate));
 return {clubs,monthly:records.filter(s=>s.startDate.startsWith(month)).length,upcoming:records.filter(s=>s.status==='planned'&&(s.endDate||s.startDate)>=today)};
}
export function renderHome(data,templates){
 const root=el('div','moily-home'),summary=homeSummary(data),ready=Array.isArray(data.clubs)&&Array.isArray(data.schedules);
 const hero=el('section','moily-panel moily-stack home-hero');
 hero.append(el('p','moily-caption',(data.profile?.nickname||'회원')+'님, 안녕하세요!'),el('h2','moily-heading','함께하는 오늘,\n설레는 내일.'),el('p','moily-caption','이번 달 모임'),el('p','moily-number',data.error?'확인 필요':ready?summary.monthly+'개':'확인 중…'));
 root.append(hero);
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
 root.append(section);return root;
}
