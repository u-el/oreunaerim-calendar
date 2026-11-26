import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, terminate, clearIndexedDbPersistence, collection, doc, getDoc, serverTimestamp, onSnapshot, runTransaction, setDoc } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js';

const app = initializeApp({
  apiKey: "AIzaSyD4uA0-Pyc-Gs0Ek_ZAZ3tgEh4dSb7o8i8",
  authDomain: "moily-dev-be0d4.firebaseapp.com",
  projectId: "moily-dev-be0d4",
  storageBucket: "moily-dev-be0d4.firebasestorage.app",
  messagingSenderId: "837889312863",
  appId: "1:837889312863:web:3c3d310f5dd9e06b8cf3ea"
});
const auth = getAuth(app);
// 마지막으로 받은 계정 일정을 기기에 저장해 두고 오프라인에서도 보여 줌
const db = initializeFirestore(app, {localCache: persistentLocalCache({tabManager: persistentMultipleTabManager()})});
const provider = new GoogleAuthProvider();
provider.setCustomParameters({prompt:'select_account'});

function schedules(uid) {
  return collection(db, 'accounts', uid, 'schedules');
}

export function observeAccount(callback) {
  return onAuthStateChanged(auth, callback);
}

export function observeSchedules(uid, onRecords, onError) {
  return onSnapshot(schedules(uid), {includeMetadataChanges:true}, snapshot => {
    onRecords(snapshot.docs.map(item => ({...item.data(),id:item.id})), snapshot.metadata.fromCache);
  }, onError);
}

export function login() {
  return signInWithPopup(auth, provider);
}

export async function logout() {
  await signOut(auth);
  // 같이 쓰는 기기에 계정 일정이 남지 않도록 기기 저장본을 지움
  try {
    await terminate(db);
    await clearIndexedDbPersistence(db);
  } catch {}
  location.reload();
}

export function saveSchedule(uid, record) {
  const ref = doc(schedules(uid), record.id);
  return runTransaction(db, async transaction => {
    const current = await transaction.get(ref);
    if (current.data()?.deleted === true) throw new Error('Schedule was deleted');
    transaction.set(ref, record);
  });
}

export function removeSchedule(uid, id) {
  const ref = doc(schedules(uid), id);
  return runTransaction(db, async transaction => {
    const current = await transaction.get(ref);
    if (current.exists() && current.data().deleted !== true) {
      transaction.update(ref, {deleted: true});
    }
  });
}

export async function importSchedules(uid, records) {
  const groupSize = 75;
  for (let index = 0; index < records.length; index += groupSize) {
    const group = records.slice(index,index+groupSize);
    await runTransaction(db, async transaction => {
      const refs = group.map(record => doc(schedules(uid),record.id));
      const existing = await Promise.all(refs.map(ref => transaction.get(ref)));
      for (const [offset,record] of group.entries()) {
        if (!existing[offset].exists()) transaction.set(refs[offset],record);
      }
    });
  }
}

export function addSharedSchedule(uid, record) {
  const ref = doc(schedules(uid), record.id);
  return runTransaction(db, async transaction => {
    const current = await transaction.get(ref);
    if (current.exists() && current.data()?.deleted !== true) return false;
    transaction.set(ref, record);
    return true;
  });
}

function gearSetsDoc(uid) {
  return doc(db, 'accounts', uid, 'settings', 'gearSets');
}

export function observeGearSets(uid, onSets, onError) {
  return onSnapshot(gearSetsDoc(uid), snapshot => {
    const sets = snapshot.data()?.sets;
    onSets(Array.isArray(sets) ? sets : []);
  }, onError);
}

export function saveGearSets(uid, sets) {
  return setDoc(gearSetsDoc(uid), {sets, updatedAt: Date.now()});
}

function profileDoc(uid) {
  return doc(db, 'accounts', uid, 'settings', 'profile');
}

export function observeProfile(uid, onProfile, onError) {
  return onSnapshot(profileDoc(uid), snapshot => onProfile(snapshot.data() || {}), onError);
}

export function saveProfile(uid, nickname) {
  return setDoc(profileDoc(uid), {nickname, updatedAt: Date.now()});
}

// 짧은 공유 링크: 공유 내용을 shares/{id}에 저장하고 주소에는 id만 넣음
const shareAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
function shareId() {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, byte => shareAlphabet[byte % shareAlphabet.length]).join('');
}

export async function createShare(uid, payload) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const id = shareId();
    try {
      await setDoc(doc(db, 'shares', id), {...payload, owner: uid, createdAt: Date.now()});
      return id;
    } catch (error) {
      // 같은 id가 이미 있으면(규칙상 덮어쓰기 불가) 다른 id로 다시 시도
      if (error?.code !== 'permission-denied' || attempt === 2) throw error;
    }
  }
}

export async function getShare(id) {
  const snapshot = await getDoc(doc(db, 'shares', id));
  return snapshot.exists() ? snapshot.data() : null;
}

export async function ensureMoilyProfile(uid) {
  if (!auth.currentUser || auth.currentUser.uid !== uid) throw new Error('Account mismatch');
  const ref = doc(db,'accounts',uid,'settings','moilyProfile');
  return runTransaction(db, async tx => {
    const snapshot = await tx.get(ref);
    if (snapshot.exists()) return snapshot.data();
    const draft = {schemaVersion:2,nickname:'',interests:[],onboardingCompleted:false};
    tx.set(ref,{...draft,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
    return draft;
  });
}

export async function getMoilyConsent(uid) {
  if(auth.currentUser?.uid!==uid) throw new Error('Account mismatch');
  const snap=await getDoc(doc(db,'accounts',uid,'settings','moilyConsent'));
  return snap.exists()?snap.data():null;
}
export async function saveMoilyConsent(uid, choices) {
  if(auth.currentUser?.uid!==uid || choices.terms!==true || choices.privacy!==true || typeof choices.marketing!=='boolean') throw new Error('Invalid consent');
  const ref=doc(db,'accounts',uid,'settings','moilyConsent');
  return runTransaction(db,async tx=>{
    const snap=await tx.get(ref);
    if(snap.exists()) return snap.data();
    const data={termsVersion:'test-1',privacyVersion:'test-1',termsAccepted:true,privacyAccepted:true,marketingAccepted:choices.marketing};
    tx.set(ref,{...data,acceptedAt:serverTimestamp()});
    return data;
  });
}

export async function saveMoilyProfile(uid,nickname,interests) {
  nickname=nickname.trim();
  const allowed=['hiking','running','cycling','tennis','other'];
  if(auth.currentUser?.uid!==uid || !nickname || nickname.length>20 || !Array.isArray(interests) || interests.length>5 || interests.some(x=>!allowed.includes(x))) throw new Error('Invalid profile');
  const ref=doc(db,'accounts',uid,'settings','moilyProfile');
  return runTransaction(db,async tx=>{
    const snap=await tx.get(ref);
    if(!snap.exists()||snap.data().onboardingCompleted!==false)throw new Error('Invalid draft');
    tx.update(ref,{nickname,interests:[...new Set(interests)],updatedAt:serverTimestamp()});
    return {...snap.data(),nickname,interests:[...new Set(interests)]};
  });
}

export const moilyClubTemplates={
 hiking:{label:'등산',icon:'mountain',color:'#2F6B4F',activities:['산행','백패킹','먹벙','놀이벙']},
 running:{label:'러닝',icon:'footprints',color:'#E58D65',activities:['러닝','훈련','대회']},
 cycling:{label:'자전거',icon:'bike',color:'#629FC7',activities:['라이딩','훈련','대회']},
 tennis:{label:'테니스',icon:'circle-dot',color:'#91AB56',activities:['연습','경기','레슨']},
 other:{label:'기타',icon:'shapes',color:'#9A83C7',activities:['정기 모임','번개 모임']}
};
export async function getMoilyFirstClub(uid){
 if(auth.currentUser?.uid!==uid)throw new Error('Account mismatch');
 const snap=await getDoc(doc(db,'accounts',uid,'clubs','onboarding-first'));
 return snap.exists()?snap.data():null;
}
export async function createMoilyFirstClub(uid,{category,name,description,color}){
 name=name.trim();description=description.trim();
 const template=Object.hasOwn(moilyClubTemplates,category)?moilyClubTemplates[category]:null;
 if(auth.currentUser?.uid!==uid||!template||!name||name.length>60||description.length>300||!/^#[0-9A-Fa-f]{6}$/.test(color))throw new Error('Invalid club');
 const id='onboarding-first',ref=doc(db,'accounts',uid,'clubs',id);
 return runTransaction(db,async tx=>{
 const [existing,profile,consent]=await Promise.all([tx.get(ref),tx.get(doc(db,'accounts',uid,'settings','moilyProfile')),tx.get(doc(db,'accounts',uid,'settings','moilyConsent'))]);
 if(existing.exists())return existing.data();
 if(!profile.data()?.nickname?.trim()||profile.data()?.onboardingCompleted!==false||consent.data()?.termsAccepted!==true||consent.data()?.privacyAccepted!==true)throw new Error('Incomplete onboarding');
 const common={schemaVersion:2,version:1,createdAt:serverTimestamp(),updatedAt:serverTimestamp(),deletedAt:null};
 const club={id,name,description,category,color,icon:template.icon,status:'active',isPrimary:true,isFavorite:false,sortOrder:0};
 const refs=template.activities.map((_,i)=>doc(db,'accounts',uid,'activityTypes',id+'-'+i));
 const prior=await Promise.all(refs.map(r=>tx.get(r)));
 if(prior.some(x=>x.exists()))throw new Error('Template conflict');
 tx.set(ref,{...club,...common});
 template.activities.forEach((name,i)=>tx.set(refs[i],{...common,id:refs[i].id,clubId:id,name,color:category==='hiking'?['#2F6B4F','#BCA8E8','#F4D36A','#A5D8F3'][i]:color,icon:template.icon,templateId:category,sortOrder:i,isHidden:false}));
 return club;
 });
}

export async function completeMoilyOnboarding(uid){
 if(auth.currentUser?.uid!==uid)throw new Error('Account mismatch');
 const ref=doc(db,'accounts',uid,'settings','moilyProfile');
 return runTransaction(db,async tx=>{
 const [p,c,club]=await Promise.all([tx.get(ref),tx.get(doc(db,'accounts',uid,'settings','moilyConsent')),tx.get(doc(db,'accounts',uid,'clubs','onboarding-first'))]);
 const profile=p.data(),consent=c.data();
 if(!profile?.nickname?.trim()||consent?.termsAccepted!==true||consent?.privacyAccepted!==true||consent?.termsVersion!=='test-1'||consent?.privacyVersion!=='test-1')throw new Error('Incomplete onboarding');
 if(!profile.onboardingCompleted)tx.update(ref,{onboardingCompleted:true,updatedAt:serverTimestamp()});
 return {nickname:profile.nickname,club:club.exists()?club.data():null};
 });
}
