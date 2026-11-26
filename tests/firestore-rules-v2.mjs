import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, updateDoc, deleteDoc, collection, getDocs, serverTimestamp, Timestamp } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
const env = await initializeTestEnvironment({projectId:'demo-moily',firestore:{rules:readFileSync('firestore.rules','utf8')}});
try {
 const a=env.authenticatedContext('alice').firestore(), b=env.authenticatedContext('bob').firestore(), guest=env.unauthenticatedContext().firestore();
 const path='accounts/alice/clubs/c1';
 const data={id:'c1',name:'Test',status:'active',schemaVersion:2,version:1,createdAt:serverTimestamp(),updatedAt:serverTimestamp(),deletedAt:null};
 await assertSucceeds(setDoc(doc(a,path),data));
 await assertSucceeds(getDoc(doc(a,path)));
 await assertFails(getDoc(doc(b,path)));
 await assertFails(getDoc(doc(guest,path)));
 await assertFails(updateDoc(doc(b,path),{name:'bad'}));
 await assertFails(deleteDoc(doc(a,path)));
 await assertFails(setDoc(doc(a,'accounts/alice/clubs/c2'),{...data,id:'c2',status:'invalid'}));
 await assertFails(updateDoc(doc(a,path),{name:'stale',version:1,updatedAt:serverTimestamp()}));
 await assertSucceeds(updateDoc(doc(a,path),{status:'trashed',deletedAt:serverTimestamp(),version:2,updatedAt:serverTimestamp()}));
 await assertFails(updateDoc(doc(a,path),{status:'active',deletedAt:null,version:3,updatedAt:serverTimestamp()}));
 const valid='a'.repeat(32), expired='b'.repeat(32), revoked='c'.repeat(32);
 await env.withSecurityRulesDisabled(async ctx=>{
  const db=ctx.firestore();
  await setDoc(doc(db,'sharesV2',valid),{snapshot:{title:'Test'},revokedAt:null,expiresAt:null});
  await setDoc(doc(db,'sharesV2',expired),{snapshot:{title:'Test'},revokedAt:null,expiresAt:Timestamp.fromMillis(1)});
  await setDoc(doc(db,'sharesV2',revoked),{snapshot:{title:'Test'},revokedAt:Timestamp.now(),expiresAt:null});
 });
 await assertSucceeds(getDoc(doc(guest,'sharesV2',valid)));
 await assertFails(getDoc(doc(guest,'sharesV2',expired)));
 await assertFails(getDoc(doc(guest,'sharesV2',revoked)));
 await assertFails(getDocs(collection(guest,'sharesV2')));
 await assertFails(setDoc(doc(a,'sharesV2','d'.repeat(32)),{revokedAt:null,expiresAt:null}));
 await assertSucceeds(setDoc(doc(a,'accounts/alice/schedules/legacy'),{id:'legacy',name:'Legacy',gear:[],certified:[]}));
 await assertFails(getDoc(doc(b,'accounts/alice/schedules/legacy')));
 console.log('17 assertions passed');
} finally { await env.cleanup(); }
