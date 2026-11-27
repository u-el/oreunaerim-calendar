const $=id=>document.getElementById(id);
let generation=0,activeUid=null,started=false;
const lock=()=>{document.body.classList.add('moily-locked');$('moily-entry').hidden=false;for(const d of document.querySelectorAll('dialog[open]'))d.close();};
const fail=()=>{lock();$('entry-status').textContent='계정 상태를 확인하지 못했어요. 인터넷 연결을 확인해 주세요.';$('entry-retry').hidden=false;};
$('entry-retry').onclick=()=>location.reload();
function login(){const target=new URL('moily-login.html',location.href);target.hash=location.hash;location.replace(target);}
try{
 const api=await import('./sync.mjs');
 api.observeAccount(async user=>{
 const g=++generation;lock();
 if(!user){login();return;}
 if(started&&activeUid!==user.uid){location.reload();return;}
 try{
 const profile=await api.ensureMoilyProfile(user.uid);
 if(g!==generation)return;
 if(profile.onboardingCompleted!==true){login();return;}
 if(!started){
 activeUid=user.uid;started=true;
 const script=document.createElement('script');script.src='app.js?v=moily-entry-1';script.onerror=fail;script.onload=()=>{if(g===generation){$('moily-entry').hidden=true;document.body.classList.remove('moily-locked');}};document.head.append(script);
 }else{$('moily-entry').hidden=true;document.body.classList.remove('moily-locked');}
 }catch{if(g===generation)fail();}
 });
}catch{fail();}
