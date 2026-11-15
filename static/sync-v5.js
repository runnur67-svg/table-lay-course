/* TABLE LAY Firebase bridge — dedicated shared Firebase Auth account; authenticated Firestore only. */
(() => {
  'use strict';
  const SDK_VERSION='10.14.1';
  const CONFIG_KEY='tablelay-firebase-v5-config';
  const ENROLLED_KEY='tablelay-firebase-v5-enrolled';
  let firebaseApp=null, auth=null, firestore=null, doc=null, unsubscribe=null;
  let config=null, connected=false, listener=null, failed=null;
  const loadScript = url => new Promise((resolve,reject)=>{
    const tag=document.createElement('script');tag.src=url;tag.async=true;
    tag.onload=resolve;tag.onerror=()=>reject(new Error('Firebase SDK 로드 실패: 인터넷 연결을 확인하세요.'));
    document.head.append(tag);
  });
  const clone=x=>JSON.parse(JSON.stringify(x));
  function readConfig(){try{return JSON.parse(localStorage.getItem(CONFIG_KEY)||'null');}catch{return null;}}
  function saveConfig(c){localStorage.setItem(CONFIG_KEY,JSON.stringify(c));}
  function checkConfig(c){
    if(!c||!['apiKey','authDomain','projectId','appId'].every(k=>typeof c[k]==='string'&&c[k].trim()))
      throw new Error('Firebase 설정 JSON의 apiKey, authDomain, projectId, appId가 필요합니다.');
    if(!/^[a-z0-9-]+$/i.test(c.projectId))throw new Error('Firebase projectId가 올바르지 않습니다.');
    return c;
  }
  async function initialize(c){
    config=checkConfig(c);
    if(!window.firebase){
      await loadScript(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-app-compat.js`);
      await loadScript(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-auth-compat.js`);
      await loadScript(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-firestore-compat.js`);
    }
    if(firebaseApp){
      if(firebaseApp.options.projectId!==config.projectId||firebaseApp.options.apiKey!==config.apiKey)
        throw new Error('다른 Firebase 프로젝트로 변경하려면 앱을 다시 열어주세요.');
    }else firebaseApp=window.firebase.initializeApp(config,'table-lay-course-v5');
    auth=firebaseApp.auth();
    firestore=firebaseApp.firestore();
    doc=firestore.collection('tablelay_sync').doc('live');
    saveConfig(config);
    return true;
  }
  async function restoreLogin(){
    if(!auth)throw new Error('먼저 Firebase 프로젝트 설정을 입력하세요.');
    const user=await new Promise(resolve=>{const off=auth.onAuthStateChanged(u=>{off();resolve(u)},()=>{off();resolve(null)});});
    if(!user)throw new Error('Firebase 로그인 세션이 만료되었습니다. 태블릿 연동에서 다시 로그인하세요.');
    return user.uid;
  }
  async function login(email,password){
    if(!auth)throw new Error('먼저 Firebase 프로젝트 설정을 입력하세요.');
    if(!navigator.onLine)throw new Error('인터넷이 연결되어야 로그인할 수 있습니다.');
    const result=await auth.signInWithEmailAndPassword(email.trim(),password);
    return result.user.uid;
  }
  async function readCloud(){
    if(!auth?.currentUser)throw new Error('Firebase 계정 로그인이 필요합니다.');
    const snap=await doc.get({source:'server'});
    return snap.exists ? snap.data().state : null;
  }
  async function firstUpload(store){
    if(!auth?.currentUser)throw new Error('로그인이 필요합니다.');
    await firestore.runTransaction(async tx=>{
      const snap=await tx.get(doc);
      if(snap.exists)throw new Error('클라우드에 이미 데이터가 있습니다. 기존 데이터를 불러와 연결하세요.');
      tx.set(doc,{state:clone(store),updatedAt:window.firebase.firestore.FieldValue.serverTimestamp()});
    });
  }
  function attach(onRemote,onProblem){
    if(unsubscribe)unsubscribe();
    listener=onRemote;failed=onProblem;
    connected=true;
    unsubscribe=doc.onSnapshot({includeMetadataChanges:true},snap=>{
      if(!snap.exists){connected=false;failed?.(new Error('클라우드 문서가 삭제되었습니다.'));return;}
      if(snap.metadata.fromCache){connected=false;failed?.(new Error('서버 연결 확인 중 — 조작을 잠시 중단하세요.'));return;}
      connected=true;
      listener?.(clone(snap.data().state));
    },e=>{connected=false;failed?.(e);});
  }
  function detach(){if(unsubscribe){unsubscribe();unsubscribe=null;}connected=false;listener=null;failed=null;}
  const eq=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  function changes(before,after,path=[],out=[]){
    if(eq(before,after))return out;
    if(path.at(-1)==='revision'||path.length===1&&path[0]==='activeRound')return out;
    if(Array.isArray(before)&&Array.isArray(after)&&before.length===after.length){
      before.forEach((a,i)=>changes(a,after[i],[...path,i],out));return out;
    }
    if(before&&after&&typeof before==='object'&&typeof after==='object'&&!Array.isArray(before)&&!Array.isArray(after)){
      for(const key of new Set([...Object.keys(before),...Object.keys(after)]))changes(before[key],after[key],[...path,key],out);
      return out;
    }
    out.push({path,old:clone(before===undefined?null:before),next:clone(after===undefined?null:after)});
    return out;
  }
  function get(o,path){return path.reduce((a,k)=>a?.[k],o);}
  function set(o,path,value){let target=o;for(const k of path.slice(0,-1))target=target[k];target[path.at(-1)]=clone(value);}
  async function transact(before,after){
    if(!connected||!navigator.onLine)throw new Error('실시간 연결이 끊어졌습니다. 복구 후 다시 시도하세요.');
    const patch=changes(before,after);
    if(!patch.length)return before;
    let result=null;
    await firestore.runTransaction(async tx=>{
      const snap=await tx.get(doc);
      if(!snap.exists)throw new Error('공유 데이터가 없습니다.');
      const remote=clone(snap.data().state);
      for(const change of patch){
        if(!eq(get(remote,change.path)??null,change.old)){
          const e=new Error('다른 태블릿에서 같은 정보가 먼저 변경되었습니다. 최신 상태를 확인한 후 다시 눌러주세요.');
          e.isConflict=true;throw e;
        }
        set(remote,change.path,change.next);
      }
      const touchedRounds=new Set(patch.map(p=>p.path[0]==='rounds'?p.path[1]:null).filter(Boolean));
      for(const id of touchedRounds){remote.rounds[id].round.revision=(remote.rounds[id].round.revision||0)+1;}
      tx.set(doc,{state:remote,updatedAt:window.firebase.firestore.FieldValue.serverTimestamp()});
      result=remote;
    });
    return result;
  }
  window.TableLaySync={readConfig,initialize,login,restoreLogin,readCloud,firstUpload,attach,detach,transact,
    isEnrolled:()=>localStorage.getItem(ENROLLED_KEY)==='yes',
    setEnrolled:v=>v?localStorage.setItem(ENROLLED_KEY,'yes'):localStorage.removeItem(ENROLLED_KEY),
    isReady:()=>connected,uid:()=>auth?.currentUser?.uid||null,
    signOut:async()=>{detach();await auth?.signOut()},clearConfig:()=>localStorage.removeItem(CONFIG_KEY)};
})();
