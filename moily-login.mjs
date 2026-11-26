import {button} from './moily-components.mjs';
const $=id=>document.getElementById(id);
let api, busy=false, account=null, ready=false;
const status=t=>{$('status').textContent=t;};
const google=button('Google로 계속하기',{variant:'secondary',disabled:true,onClick:async()=>{
 if(!ready||busy||account)return;busy=true;google.disabled=true;status('Google 로그인 진행 중…');
 try{await api.login();}catch(e){status(e?.code==='auth/popup-blocked'?'팝업을 허용하고 다시 시도해 주세요.':e?.code==='auth/popup-closed-by-user'?'로그인이 취소되었어요. 다시 시도할 수 있어요.':'로그인하지 못했어요. 외부 브라우저에서 다시 시도해 주세요.');}finally{busy=false;google.disabled=!ready||!!account;}
}});
$('google').append(google);
const out=button('로그아웃',{variant:'secondary',onClick:async()=>{out.disabled=true;try{await api.logout();}catch{status('로그아웃하지 못했어요. 다시 시도해 주세요.');out.disabled=false;}}});
$('logout').append(out);
try{api=await import('./sync.mjs');api.observeAccount(user=>{account=user;ready=true;google.disabled=busy||!!user;$('google').hidden=!!user;$('continue').hidden=!user;$('logout').hidden=!user;status(user?'Google 로그인 완료. 신규 온보딩은 다음 단계에서 연결됩니다.':'Google 계정으로 로그인해 주세요.');});}catch{status('인증을 불러오지 못했어요. 인터넷 연결을 확인하고 새로고침해 주세요.');}
