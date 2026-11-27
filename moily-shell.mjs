import {navigation,button} from './moily-components.mjs';
const $=id=>document.getElementById(id);
const routes={home:'홈',clubs:'동호회',calendar:'캘린더',activity:'활동 기록',my:'마이'};
const scrolls=new Map();let current=null,uid=null,generation=0;
const device=()=>matchMedia('(min-width:1200px)').matches?'desktop':matchMedia('(min-width:768px)').matches?'tablet':'mobile';
const labels={desktop:'PC',tablet:'태블릿',mobile:'모바일'};
function applyDevice(){document.body.dataset.device=device();$('shell-device').textContent=labels[device()]+' 레이아웃';}
for(const q of ['(min-width:768px)','(min-width:1200px)'])matchMedia(q).addEventListener('change',applyDevice);
applyDevice();
function route(){const key=location.hash.slice(1);return Object.hasOwn(routes,key)?key:'home';}
function render(){if(!uid)return;const next=route();if(current===next)return;if(current)scrolls.set(current,window.scrollY);current=next;
$('shell-title').textContent=routes[next];document.title=routes[next]+' · 모일리';
$('shell-nav-items').replaceChildren(navigation(Object.entries(routes).map(([key,label])=>({label,active:key===next,href:'#'+key}))));
const panel=document.createElement('section');panel.className='moily-panel';const p=document.createElement('p');p.textContent='이 메뉴의 실제 기능은 이후 개발 단계에서 연결됩니다.';panel.append(p);
if(next==='calendar'||next==='home'){const a=document.createElement('a');a.href='./';a.textContent='기존 개발용 캘린더 열기';panel.append(a);}
if(next==='my'){const a=document.createElement('a');a.href='moily-account.html';a.textContent='로그인 계정 연결';panel.append(a);}
$('shell-content').replaceChildren(panel);$('shell-main').focus({preventScroll:true});window.scrollTo(0,scrolls.get(next)||0);}
if('scrollRestoration' in history)history.scrollRestoration='manual';
window.addEventListener('hashchange',render);
$('shell-retry').onclick=()=>location.reload();
function fail(){ $('shell').hidden=true;$('shell-status').hidden=false;$('shell-message').textContent='계정 확인에 실패했어요.';$('shell-retry').hidden=false;}
try{const api=await import('./sync.mjs');api.observeAccount(async user=>{const g=++generation;$('shell').hidden=true;$('shell-status').hidden=false;$('shell-message').textContent='계정 확인 중…';$('shell-retry').hidden=true;uid=null;current=null;scrolls.clear();if(!user){location.replace('moily-login.html');return;}try{const p=await api.ensureMoilyProfile(user.uid);if(g!==generation)return;if(!p.onboardingCompleted){location.replace('moily-login.html');return;}uid=user.uid;$('shell-status').hidden=true;$('shell').hidden=false;render();}catch{if(g===generation)fail();}});}catch{fail();}
