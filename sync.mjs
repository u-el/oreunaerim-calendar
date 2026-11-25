import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js';
import { getFirestore, collection, doc, onSnapshot, runTransaction } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js';

const app = initializeApp({
  apiKey: 'AIzaSyAvNt0OvhibmXN4wZr1gjP2UZMO91jnyR8',
  authDomain: 'oreunaerim-calendar.firebaseapp.com',
  projectId: 'oreunaerim-calendar',
  appId: '1:810927578233:web:ac23ad3356a1fb4e4d88a8'
});
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({prompt:'select_account'});

function schedules(uid) {
  return collection(db, 'accounts', uid, 'schedules');
}

export function observeAccount(callback) {
  return onAuthStateChanged(auth, callback);
}

export function observeSchedules(uid, onRecords, onError) {
  return onSnapshot(schedules(uid), snapshot => {
    onRecords(snapshot.docs.map(item => ({...item.data(),id:item.id})));
  }, onError);
}

export function login() {
  return signInWithPopup(auth, provider);
}

export function logout() {
  return signOut(auth);
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
