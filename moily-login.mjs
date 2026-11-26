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
try{api=await import('./sync.mjs');let generation=0;api.observeAccount(async user=>{
 const current=++generation;account=user;ready=true;google.disabled=busy||!!user;
 $('google').hidden=!!user;$('continue').hidden=true;$('logout').hidden=!user;
 if(!user){status('Google 계정으로 로그인해 주세요.');return;}
 status('모일리 프로필 확인 중…');
 try{const profile=await api.ensureMoilyProfile(user.uid);if(current!==generation)return;
 status(profile.onboardingCompleted===true?'모일리 가입 완료 계정입니다.':'신규 또는 가입 진행 중인 계정입니다. 온보딩은 다음 단계에서 연결됩니다.');
 $('continue').hidden=false;
 }catch(e){if(current!==generation)return;status('프로필을 확인하지 못했어요. 연결 및 개발용 보안 규칙을 확인한 뒤 새로고침해 주세요.');}
 });}catch{status('인증을 불러오지 못했어요. 인터넷 연결을 확인하고 새로고침해 주세요.');}
