import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, terminate, clearIndexedDbPersistence, collection, doc, getDoc, onSnapshot, runTransaction, setDoc } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js';

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
