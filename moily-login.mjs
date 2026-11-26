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
const choices=['terms','privacy','marketing'].map($);
const all=$('all-consent');
let saving=false;
const next=button('다음',{disabled:true,onClick:async()=>{
 if(saving||!account||!choices[0].checked||!choices[1].checked)return;
 const uid=account.uid;saving=true;refreshConsent();
 try{await api.saveMoilyConsent(uid,{terms:choices[0].checked,privacy:choices[1].checked,marketing:choices[2].checked});
 if(account?.uid!==uid)return;
 showProfile();
 }catch{if(account?.uid===uid)status('동의를 저장하지 못했어요. 다시 시도해 주세요.');}
 finally{saving=false;refreshConsent();}
}});
$('consent-next').append(next);
function refreshConsent(){all.checked=choices.every(x=>x.checked);all.indeterminate=!all.checked&&choices.some(x=>x.checked);next.disabled=saving||!choices[0].checked||!choices[1].checked;all.disabled=saving;choices.forEach(x=>x.disabled=saving);}
all.addEventListener('change',()=>{choices.forEach(x=>x.checked=all.checked);refreshConsent();});
choices.forEach(x=>x.addEventListener('change',refreshConsent));
let draftProfile=null,profileSaving=false;
const nickname=$('nickname'), interests=[...$('interests').querySelectorAll('input')];
const profileNext=button('다음',{disabled:true,onClick:async()=>{
 if(profileSaving||!account||!nickname.value.trim()||nickname.value.trim().length>20)return;
 const uid=account.uid;profileSaving=true;refreshProfile();
 try{draftProfile=await api.saveMoilyProfile(uid,nickname.value,interests.filter(x=>x.checked).map(x=>x.value));
 if(account?.uid!==uid)return;
 $('profile-step').hidden=true;status('프로필 저장 완료. 첫 동호회 생성은 다음 단계에서 연결됩니다.');$('continue').hidden=false;
 }catch{if(account?.uid===uid)status('프로필을 저장하지 못했어요. 다시 시도해 주세요.');}
 finally{profileSaving=false;refreshProfile();}
}});
$('profile-next').append(profileNext);
function refreshProfile(){const n=nickname.value.trim();$('nickname-count').textContent=nickname.value.length+' / 20';profileNext.disabled=profileSaving||!n||n.length>20;nickname.disabled=profileSaving;interests.forEach(x=>x.disabled=profileSaving);}
nickname.addEventListener('input',refreshProfile);
function showProfile(){ $('consent').hidden=true; $('continue').hidden=true; nickname.value=draftProfile?.nickname||'';interests.forEach(x=>x.checked=(draftProfile?.interests||[]).includes(x.value));refreshProfile();$('profile-step').hidden=false;status('닉네임과 관심 활동을 설정해 주세요.');}
function resumeProfile(){if(draftProfile?.nickname?.trim()){status('프로필 저장 완료. 첫 동호회 생성은 다음 단계에서 연결됩니다.');$('continue').hidden=false;}else showProfile();}
try{api=await import('./sync.mjs');let generation=0;api.observeAccount(async user=>{
 const current=++generation;account=user;draftProfile=null;$('profile-step').hidden=true;nickname.value='';interests.forEach(x=>x.checked=false);refreshProfile();$('consent').hidden=true;choices.forEach(x=>x.checked=false);refreshConsent();ready=true;google.disabled=busy||!!user;
 $('google').hidden=!!user;$('continue').hidden=true;$('logout').hidden=!user;
 if(!user){status('Google 계정으로 로그인해 주세요.');return;}
 status('모일리 프로필 확인 중…');
 try{const profile=await api.ensureMoilyProfile(user.uid);if(current!==generation)return;draftProfile=profile;
 if(profile.onboardingCompleted===true){status('모일리 가입 완료 계정입니다.');$('continue').hidden=false;return;}
 const consent=await api.getMoilyConsent(user.uid);if(current!==generation)return;
 if(consent?.termsVersion==='test-1'&&consent?.privacyVersion==='test-1'&&consent.termsAccepted===true&&consent.privacyAccepted===true){resumeProfile();}
 else{status('가입을 위해 약관에 동의해 주세요.');$('consent').hidden=false;}
 }catch(e){if(current!==generation)return;status('프로필을 확인하지 못했어요. 연결 및 개발용 보안 규칙을 확인한 뒤 새로고침해 주세요.');}
 });}catch{status('인증을 불러오지 못했어요. 인터넷 연결을 확인하고 새로고침해 주세요.');}
