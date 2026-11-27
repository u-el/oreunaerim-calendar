import {navigation} from './moily-components.mjs';
const $=id=>document.getElementById(id);
const routes={home:'홈',clubs:'동호회',calendar:'캘린더',activity:'활동 기록',my:'마이'};
let stopTheme=()=>{},themeApi=null,themeReady=false,themeBusy=false;
const themeSelect=$('shell-theme'),themeStatus=$('shell-theme-status');
function applyTheme(value){document.body.dataset.theme=value;themeSelect.value=value;}
function resetTheme(){stopTheme();stopTheme=()=>{};themeReady=false;themeBusy=false;applyTheme('system');themeSelect.disabled=true;themeStatus.textContent='설정 확인 중…';}
function watchTheme(api,account,g){themeApi=api;stopTheme=api.observeMoilyTheme(account,(value,meta)=>{if(g!==generation)return;applyTheme(value);themeReady=!meta.fromCache;themeSelect.disabled=!themeReady||themeBusy;themeStatus.textContent=meta.hasPendingWrites?'저장 중…':meta.fromCache?'오프라인 설정':'계정 설정 동기화 완료';},()=>{if(g!==generation)return;themeReady=false;themeSelect.disabled=true;themeStatus.textContent='설정을 불러오지 못했어요. 새로고침해 주세요.';});}
let stopLayout=()=>{},layoutDevice=null,layoutEpoch=0,layoutDraft=null,layoutReady=false,layoutBusy=false,layoutDirty=false;
const cardLabels={hero:'메인 카드',clubs:'동호회',calendar:'캘린더',upcoming:'다가오는 일정',goals:'목표'};
function layoutLock(){ $('layout-fields').disabled=!layoutReady||layoutBusy; }
function resetLayout(){++layoutEpoch;stopLayout();stopLayout=()=>{};layoutDevice=null;layoutDraft=null;layoutReady=false;layoutBusy=false;layoutDirty=false;$('layout-cards').replaceChildren();$('layout-status').textContent='설정 확인 중…';layoutLock();}
function drawLayout(){
 const h=layoutDraft.homeLayout,container=$('layout-cards');container.replaceChildren();
 h.order.forEach((key,i)=>{const row=document.createElement('div'),label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.checked=!h.hidden.includes(key);check.onchange=()=>{h.hidden=check.checked?h.hidden.filter(x=>x!==key):[...h.hidden,key];markLayout();};label.append(check,cardLabels[key]);row.append(label);
 for(const [delta,title] of [[-1,'위로'],[1,'아래로']]){const b=document.createElement('button');b.type='button';b.textContent=title;b.setAttribute('aria-label',cardLabels[key]+' '+title);b.disabled=i+delta<0||i+delta>=h.order.length;b.onclick=()=>{[h.order[i],h.order[i+delta]]=[h.order[i+delta],h.order[i]];markLayout();drawLayout();};row.append(b);}container.append(row);});
 $('layout-size').value=h.cardSize;$('layout-calendar').value=layoutDraft.calendarView;
}
function markLayout(){layoutDirty=true;$('layout-status').textContent='저장하지 않은 변경 사항';}
function watchLayout(api,account,g){resetLayout();const epoch=layoutEpoch,d=device();layoutDevice=d;$('layout-device').textContent=labels[d]+' 설정';
 stopLayout=api.observeMoilyLayout(account,d,(value,meta)=>{if(g!==generation||epoch!==layoutEpoch)return;layoutReady=!meta.fromCache;if(!layoutDirty){layoutDraft=value;drawLayout();$('layout-status').textContent=meta.hasPendingWrites?'저장 중…':meta.fromCache?'오프라인 설정':'기기 설정 동기화 완료';}layoutLock();},()=>{if(g!==generation||epoch!==layoutEpoch)return;layoutReady=false;layoutLock();$('layout-status').textContent='설정 확인 실패. 새로고침해 주세요.';});
}
async function persistLayout(reset=false){if(!uid||!layoutReady||layoutBusy||!layoutDraft)return;const epoch=layoutEpoch,g=generation,d=layoutDevice,account=uid;const value=reset?themeApi.defaultMoilyLayout():layoutDraft;layoutBusy=true;layoutLock();$('layout-status').textContent='저장 중…';try{await themeApi.saveMoilyLayout(account,d,value);if(g===generation&&epoch===layoutEpoch){layoutDraft=value;layoutDirty=false;drawLayout();$('layout-status').textContent='기기 설정 저장 완료';}}catch{if(g===generation&&epoch===layoutEpoch)$('layout-status').textContent='저장 실패. 다시 시도해 주세요.';}finally{if(g===generation&&epoch===layoutEpoch){layoutBusy=false;layoutLock();}}}
$('layout-size').onchange=()=>{if(layoutDraft){layoutDraft.homeLayout.cardSize=$('layout-size').value;markLayout();}};
$('layout-calendar').onchange=()=>{if(layoutDraft){layoutDraft.calendarView=$('layout-calendar').value;markLayout();}};
$('layout-save').onclick=()=>persistLayout();
$('layout-reset').onclick=()=>{if(confirm('현재 기기 레이아웃만 기본값으로 복원할까요?'))persistLayout(true);};
const scrolls=new Map();let current=null,uid=null,generation=0;
const device=()=>matchMedia('(min-width:1200px)').matches?'desktop':matchMedia('(min-width:768px)').matches?'tablet':'mobile';
const labels={desktop:'PC',tablet:'태블릿',mobile:'모바일'};
function applyDevice(){document.body.dataset.device=device();$('shell-device').textContent=labels[device()]+' 레이아웃';if(uid&&themeApi&&layoutDevice!==device())watchLayout(themeApi,uid,generation);}
for(const q of ['(min-width:768px)','(min-width:1200px)'])matchMedia(q).addEventListener('change',applyDevice);
applyDevice();
function route(){const key=location.hash.slice(1);if(Object.hasOwn(routes,key))return key;history.replaceState(history.state,'',location.pathname+location.search+'#home');return 'home';}
function render(){if(!uid)return;const next=route();if(current===next)return;if(current)scrolls.set(current,window.scrollY);current=next;
$('shell-title').textContent=routes[next];document.title=routes[next]+' · 모일리';
$('shell-nav-items').replaceChildren(navigation(Object.entries(routes).map(([key,label])=>({label,active:key===next,href:'#'+key}))));
const panel=document.createElement('section');panel.className='moily-panel';const p=document.createElement('p');p.textContent='이 메뉴의 실제 기능은 이후 개발 단계에서 연결됩니다.';panel.append(p);
if(next==='calendar'||next==='home'){const a=document.createElement('a');a.href='./';a.textContent='기존 개발용 캘린더 열기';panel.append(a);}
if(next==='my'){const a=document.createElement('a');a.href='moily-account.html';a.textContent='로그인 계정 연결';panel.append(a);}
$('shell-content').replaceChildren(panel);$('shell-main').focus({preventScroll:true});window.scrollTo(0,scrolls.get(next)||0);}
if('scrollRestoration' in history)history.scrollRestoration='manual';
window.addEventListener('hashchange',render);
document.querySelector('.shell-skip').addEventListener('click',event=>{event.preventDefault();if(uid){$('shell-main').focus();$('shell-main').scrollIntoView({block:'start'});}else{$('shell-status').setAttribute('tabindex','-1');$('shell-status').focus();}});
for(const link of document.querySelectorAll('.shell-home-link'))link.addEventListener('click',event=>{if(uid&&current==='home'){event.preventDefault();$('shell-main').focus({preventScroll:true});window.scrollTo(0,0);}});
$('shell-retry').onclick=()=>location.reload();
function fail(){ $('shell').hidden=true;$('shell-status').hidden=false;$('shell-message').textContent='계정 확인에 실패했어요.';$('shell-retry').hidden=false;}
try{const api=await import('./sync.mjs');api.observeAccount(async user=>{const g=++generation;resetTheme();resetLayout();$('shell').hidden=true;$('shell-status').hidden=false;$('shell-message').textContent='계정 확인 중…';$('shell-retry').hidden=true;uid=null;current=null;scrolls.clear();if(!user){location.replace('moily-login.html');return;}try{const p=await api.ensureMoilyProfile(user.uid);if(g!==generation)return;if(!p.onboardingCompleted){location.replace('moily-login.html');return;}uid=user.uid;$('shell-status').hidden=true;$('shell').hidden=false;render();watchTheme(api,uid,g);watchLayout(api,uid,g);}catch{if(g===generation)fail();}});}catch{fail();}

themeSelect.addEventListener('change',async()=>{if(!uid||!themeReady||themeBusy)return;const g=generation,account=uid,previous=document.body.dataset.theme,value=themeSelect.value;themeBusy=true;themeSelect.disabled=true;applyTheme(value);themeStatus.textContent='저장 중…';try{await themeApi.saveMoilyTheme(account,value);}catch{if(g===generation){applyTheme(previous);themeStatus.textContent='저장 실패. 다시 선택해 주세요.';}}finally{if(g===generation){themeBusy=false;themeSelect.disabled=!themeReady;}}});
