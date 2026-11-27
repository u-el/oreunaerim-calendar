import * as api from './sync.mjs';
const $=id=>document.getElementById(id);
let account=null,methods=[],busy=false,loaded=false,generation=0;
const status=t=>{$('link-status').textContent=t;};
function render(){
 for(const [kind,id,label] of [['google','google.com','Google'],['kakao','oidc.kakao','카카오']]){
 const linked=methods.includes(id);
 $(kind+'-state').textContent=label+' · '+(loaded?(linked?'연결됨':'연결되지 않음'):'확인 중');
 $('link-'+kind).disabled=busy||!loaded||!account||linked;
 }
}
async function refresh(uid){const result=await api.getMoilyLoginMethods(uid);if(account?.uid!==uid)return false;methods=result;loaded=true;return true;}
async function connect(kind){
 if(busy||!loaded||!account)return;
 const uid=account.uid,g=generation;
 if(!confirm('현재 모일리 계정에 '+(kind==='google'?'Google':'카카오')+' 로그인 방법을 추가할까요? 기존 기록은 유지됩니다.'))return;
 busy=true;render();status('계정 연결 중…');
 try{
 await api.linkMoilyLogin(uid,kind);
 if(g!==generation)return;
 loaded=false;
 await refresh(uid);
 if(g===generation)status('계정 연결이 완료됐어요.');
 }catch(e){
 if(g!==generation)return;
 const messages={'auth/credential-already-in-use':'이미 다른 모일리 계정에 연결되어 있어요. 기존 계정과 기록은 변경하지 않았어요.','auth/email-already-in-use':'다른 계정에서 사용 중인 인증 정보예요. 자동 통합하지 않아요.','auth/provider-already-linked':'이미 연결된 로그인 방법이에요.','auth/popup-closed-by-user':'연결을 취소했어요.','auth/popup-blocked':'팝업을 허용한 후 다시 시도해 주세요.','auth/requires-recent-login':'보안을 위해 다시 로그인한 후 연결해 주세요.'};
 status(messages[e?.code]||'연결 상태를 확인하지 못했어요. 새로고침 후 확인해 주세요.');
 try{await refresh(uid);}catch{loaded=false;}
 }finally{busy=false;render();}
}
$('link-google').onclick=()=>connect('google');$('link-kakao').onclick=()=>connect('kakao');
api.observeAccount(async user=>{
 const g=++generation;account=user;methods=[];loaded=false;render();
 $('methods').hidden=true;$('login-link').hidden=!!user;
 if(!user){status('먼저 유지할 모일리 계정으로 로그인해 주세요.');return;}
 status('계정 확인 중…');
 try{const p=await api.ensureMoilyProfile(user.uid);if(g!==generation)return;if(!p.onboardingCompleted){$('login-link').hidden=false;status('가입을 완료한 후 계정을 연결해 주세요.');return;}await refresh(user.uid);if(g!==generation)return;$('methods').hidden=false;status('현재 계정에 로그인 방법을 추가할 수 있어요.');render();}
 catch{if(g===generation)status('계정 정보를 확인하지 못했어요. 새로고침해 주세요.');}
});
