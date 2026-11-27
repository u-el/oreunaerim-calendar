import {button} from './moily-components.mjs';
const $=id=>document.getElementById(id);
let api, busy=false, account=null, ready=false;
const status=t=>{$('status').textContent=t;};
const kakao=$('kakao');
function refreshLogin(){google.disabled=kakao.disabled=!ready||busy||!!account;}
async function signIn(kind){
 if(!ready||busy||account)return;
 busy=true;refreshLogin();status(kind==='kakao'?'카카오 로그인 진행 중…':'Google 로그인 진행 중…');
 try{await (kind==='kakao'?api.loginKakao():api.login());}
 catch(e){
 const messages={'auth/popup-blocked':'팝업을 허용하고 다시 시도해 주세요.','auth/popup-closed-by-user':'로그인이 취소되었어요. 다시 시도할 수 있어요.','auth/cancelled-popup-request':'로그인이 취소되었어요. 다시 시도해 주세요.','auth/operation-not-allowed':'로그인 제공업체 설정을 확인해 주세요.','auth/unauthorized-domain':'허용된 인증 도메인을 확인해 주세요.','auth/account-exists-with-different-credential':'기존 로그인 방법으로 로그인해 주세요. 계정은 자동으로 통합되지 않아요.','auth/too-many-requests':'로그인 요청 한도에 도달했어요. 잠시 후 다시 시도해 주세요.','auth/network-request-failed':'인터넷 연결을 확인하고 다시 시도해 주세요.'};
 if(!account)status(messages[e?.code]||'로그인하지 못했어요. 외부 브라우저에서 다시 시도해 주세요.');
 }finally{busy=false;refreshLogin();}
}
const google=button('Google로 계속하기',{variant:'secondary',disabled:true,onClick:()=>signIn('google')});
$('google').append(google);
kakao.addEventListener('click',()=>signIn('kakao'));
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
 await resumeClub();
 }catch{if(account?.uid===uid)status('프로필을 저장하지 못했어요. 다시 시도해 주세요.');}
 finally{profileSaving=false;refreshProfile();}
}});
$('profile-next').append(profileNext);
function refreshProfile(){const n=nickname.value.trim();$('nickname-count').textContent=nickname.value.length+' / 20';profileNext.disabled=profileSaving||!n||n.length>20;nickname.disabled=profileSaving;interests.forEach(x=>x.disabled=profileSaving);}
nickname.addEventListener('input',refreshProfile);
function showProfile(){ $('consent').hidden=true; $('continue').hidden=true; nickname.value=draftProfile?.nickname||'';interests.forEach(x=>x.checked=(draftProfile?.interests||[]).includes(x.value));refreshProfile();$('profile-step').hidden=false;status('닉네임과 관심 활동을 설정해 주세요.');}
async function resumeProfile(){if(draftProfile?.nickname?.trim())await resumeClub();else showProfile();}
let clubSaving=false;
const clubName=$('club-name'),clubDescription=$('club-description'),clubColor=$('club-color');
const clubIcons={hiking:'⛰',running:'🏃',cycling:'🚲',tennis:'🎾',other:'◇'};
function selectedClubType(){return $('club-types').querySelector('input:checked')?.value||'hiking';}
function refreshClub(){
 const key=selectedClubType(),t=api.moilyClubTemplates[key],c=clubColor.value;
 $('club-preview').style.backgroundColor=c;
 const rgb=c.slice(1).match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);
 $('club-preview').style.color=(.2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2])>.179?'#000':'#fff';
 $('club-preview-icon').textContent=clubIcons[key];$('club-preview-name').textContent=clubName.value.trim()||'나의 첫 동호회';
 $('club-preview-description').textContent=clubDescription.value.trim()||t.label+' · 함께하는 즐거움';
 $('club-template').textContent='기본 활동: '+t.activities.join(' · ');
 createClub.disabled=clubSaving||!clubName.value.trim();skipClub.disabled=clubSaving;
 [clubName,clubDescription,clubColor,...$('club-types').querySelectorAll('input')].forEach(x=>x.disabled=clubSaving);
}
async function finishClub(){
 const uid=account.uid;
 const result=await api.completeMoilyOnboarding(uid);
 if(account?.uid!==uid)return;
 $('club-step').hidden=true;$('profile-step').hidden=true;$('continue').hidden=true;
 $('welcome-name').textContent=result.nickname+'님, 모일리에 오신 것을 환영해요!';
 const card=$('welcome-club');card.hidden=!result.club;card.textContent='';
 if(result.club){card.textContent=result.club.name+' · '+api.moilyClubTemplates[result.club.category]?.label+' · 첫 동호회';card.style.border='2px solid '+result.club.color;}
 $('welcome').hidden=false;status('가입 완료');
}
const createClub=button('첫 동호회 만들기',{disabled:true,onClick:async()=>{
 if(clubSaving||!account||!clubName.value.trim())return;
 const uid=account.uid;clubSaving=true;refreshClub();
 try{await api.createMoilyFirstClub(uid,{category:selectedClubType(),name:clubName.value,description:clubDescription.value,color:clubColor.value});
 if(account?.uid===uid)await finishClub();
 }catch{if(account?.uid===uid)status('동호회를 저장하지 못했어요. 다시 시도해 주세요.');}
 finally{clubSaving=false;refreshClub();}
}});
const skipClub=button('나중에 만들기',{variant:'secondary',onClick:async()=>{if(!account||clubSaving)return;const uid=account.uid;clubSaving=true;refreshClub();try{await finishClub();}catch{if(account?.uid===uid)status('가입 완료 상태를 저장하지 못했어요. 다시 시도해 주세요.');}finally{clubSaving=false;refreshClub();}}});
$('club-create').append(createClub);$('club-skip').append(skipClub);
[clubName,clubDescription,clubColor].forEach(x=>x.addEventListener('input',refreshClub));
function showClub(){
 $('profile-step').hidden=true;$('continue').hidden=true;
 const group=$('club-types');group.querySelectorAll('label').forEach(x=>x.remove());
 const preferred=draftProfile?.interests?.[0]||'hiking';
 Object.entries(api.moilyClubTemplates).forEach(([key,t])=>{const label=document.createElement('label'),input=document.createElement('input');input.type='radio';input.name='club-type';input.value=key;input.checked=key===preferred;label.append(input,document.createTextNode(clubIcons[key]+' '+t.label));group.append(label);input.addEventListener('change',()=>{clubColor.value=t.color;refreshClub();});});
 clubName.value='';clubDescription.value='';clubColor.value=api.moilyClubTemplates[selectedClubType()].color;refreshClub();$('club-step').hidden=false;status('첫 동호회를 만들거나 나중에 만들 수 있어요.');
}
async function resumeClub(){const uid=account.uid;const existing=await api.getMoilyFirstClub(uid);if(account?.uid!==uid)return;if(existing){showClub();clubName.value=existing.name;clubDescription.value=existing.description||'';clubColor.value=existing.color;const radio=[...$('club-types').querySelectorAll('input')].find(x=>x.value===existing.category);if(radio)radio.checked=true;refreshClub();await finishClub();}else showClub();}
try{api=await import('./sync.mjs');let generation=0;api.observeAccount(async user=>{
 const current=++generation;account=user;draftProfile=null;$('welcome').hidden=true;$('welcome-name').textContent='';$('welcome-club').textContent='';$('club-step').hidden=true;clubName.value='';clubDescription.value='';$('profile-step').hidden=true;nickname.value='';interests.forEach(x=>x.checked=false);refreshProfile();$('consent').hidden=true;choices.forEach(x=>x.checked=false);refreshConsent();ready=true;refreshLogin();
 $('google').hidden=!!user;kakao.hidden=!!user;$('continue').hidden=true;$('logout').hidden=!user;
 if(!user){status('Google 또는 카카오 계정으로 로그인해 주세요.');return;}
 status('모일리 프로필 확인 중…');
 try{const profile=await api.ensureMoilyProfile(user.uid);if(current!==generation)return;draftProfile=profile;
 if(profile.onboardingCompleted===true){status('모일리 가입 완료 계정입니다.');location.replace('./');return;}
 const consent=await api.getMoilyConsent(user.uid);if(current!==generation)return;
 if(consent?.termsVersion==='test-1'&&consent?.privacyVersion==='test-1'&&consent.termsAccepted===true&&consent.privacyAccepted===true){await resumeProfile();}
 else{status('가입을 위해 약관에 동의해 주세요.');$('consent').hidden=false;}
 }catch(e){if(current!==generation)return;status('프로필을 확인하지 못했어요. 연결 및 개발용 보안 규칙을 확인한 뒤 새로고침해 주세요.');}
 });}catch{status('인증을 불러오지 못했어요. 인터넷 연결을 확인하고 새로고침해 주세요.');}
