import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, terminate, clearIndexedDbPersistence, collection, doc, onSnapshot, runTransaction, setDoc } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js';

const app = initializeApp({
  apiKey: 'AIzaSyAvNt0OvhibmXN4wZr1gjP2UZMO91jnyR8',
  authDomain: 'oreunaerim-calendar.firebaseapp.com',
  projectId: 'oreunaerim-calendar',
  appId: '1:810927578233:web:ac23ad3356a1fb4e4d88a8'
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
