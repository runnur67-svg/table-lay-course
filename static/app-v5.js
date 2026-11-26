/* TABLE LAY — v5 Firebase realtime dual-tablet PWA; local practice remains isolated */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const sessionOrder = ['24-l1','24-d1','24-d2','25-l1','25-l2','25-d1','25-d2'];
  const pad = (n) => String(n).padStart(2, '0');
  const timeFormatter = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  });
  const prettyTime = (ms) => timeFormatter.format(new Date(ms));
  const create = (tag, cls, value) => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (value !== undefined) el.textContent = value;
    return el;
  };
  const DINNER = [
    ['한입거리 + 음료',0],['전채요리 1',6],['전채요리 2',15],['생선요리',25],
    ['가금류',37],['클렌저',48],['메인 스테이크',54],['디저트',70],['다과류 & 커피',82]
  ];
  // Lunch is an editable PLACEHOLDER until Table Lay finalizes the actual menu.
  const LUNCH = [
    ['한입거리 + 음료',0],['전채요리',7],['생선요리',19],['클렌저',31],
    ['메인 스테이크',44],['디저트',59],['다과류 & 커피',80]
  ];
  const SCHEDULE = [
    ['24-l1','12월 24일 · 런치 1부','2026-12-24','lunch'],
    ['24-d1','12월 24일 · 디너 1부','2026-12-24','dinner'],
    ['24-d2','12월 24일 · 디너 2부','2026-12-24','dinner'],
    ['25-l1','12월 25일 · 런치 1부','2026-12-25','lunch'],
    ['25-l2','12월 25일 · 런치 2부','2026-12-25','lunch'],
    ['25-d1','12월 25일 · 디너 1부','2026-12-25','dinner'],
    ['25-d2','12월 25일 · 디너 2부','2026-12-25','dinner']
  ];
  const DB_NAME = 'tablelay-course-pwa-v1';
  const DB_KEY = 'service-data';
  const FORMAT_NAME = 'tablelay-course-control';
  const FORMAT_VERSION = 3;
  const DONENESS=[['','굽기 미확인'],['R','레어'],['MR','미디엄 레어'],['M','미디엄'],['MW','미디엄 웰던'],['W','웰던']];
  const DRINKS=[['','미선택'],['CH','커피 HOT'],['CI','커피 ICE'],['TH','티 HOT'],['TI','티 ICE']];
  const makeGuests=(count,meal)=>Array.from({length:count},()=>({kind:meal==='lunch'?'duck':'wagyu',cook:'',drink:''}));
  let db = null;
  const app = {
    authorized: false,
    activeRound: '24-l1',
    mode: 'live',
    live: null,
    liveByRound: new Map(),
    rounds: [],
    demos: new Map(),
    clockSkew: 0,
    editingTable: 1,
    editParty: 2,
    busy: false,
    pendingTables: new Map(),
    boardSaveTimer: null,
    boardSaving: false,
    prevStatus: new Map(),
    toastTimer: null,
    lastMinute: null,
    configMeal: 'lunch',
    timeRound: '24-l1',
    timetableRound: '24-l1', editGuests: [], detailPane: 'main',
    syncActive:false, syncPending:false, syncIssue:null, remoteQueued:null, syncChecking:false, remoteApplying:false
  };
  function toast(message, error=false) {
    const box=$('toast');
    box.textContent=message;
    box.classList.toggle('error',error);
    box.classList.add('visible');
    clearTimeout(app.toastTimer);
    app.toastTimer=setTimeout(()=>box.classList.remove('visible'),3600);
  }
  function storageStatus(message, error=false) {
    const label=$('connection-status');
    label.textContent=message;
    label.classList.toggle('offline',error);
  }
  function updateStatus(){
    if(app.mode==='demo'){storageStatus('● 연습 모드 · 공유 안 함');return;}
    if(app.syncActive){
      if(app.busy){storageStatus('● 클라우드 저장 중…');return;}
      if(!navigator.onLine||!window.TableLaySync.isReady()||app.syncIssue){
        storageStatus('● 연동 끊김 · 조작 중지',true);return;
      }
      storageStatus('● 실시간 연동 중 · 2기기 공유');return;
    }
    if(app.busy){storageStatus('● 기기에 저장 중…');return;}
    storageStatus(navigator.onLine?'● 이 기기에만 저장 · 연동 꺼짐':'● 오프라인 · 이 기기에 저장');
  }
  function initialStore() {
    const rounds={};
    for (const [id,title,serviceDate,meal] of SCHEDULE) {
      rounds[id]={
        round:{id,title,service_date:serviceDate,meal,planned_start:'',planned_duration:90,revision:0,
          courses:(meal==='lunch'?LUNCH:DINNER).map(([name,minute])=>({name,minute,unit:'person'}))},
        tables:Array.from({length:10},(_,i)=>({
          number:i+1,assigned:false,party_size:2,reservation_name:null,allergy_state:'unknown',
          allergy_note:'',started_at:null,seated:false,step:0,guests:makeGuests(2,meal),updated_at:0
        }))
      };
    }
    return {activeRound:'24-l1',rounds};
  }
  function openDB(){
    return new Promise((resolve,reject)=>{
      if(!('indexedDB' in window)){reject(new Error('이 브라우저에서는 IndexedDB를 사용할 수 없습니다.'));return;}
      const req=indexedDB.open(DB_NAME,1);
      req.onupgradeneeded=()=>{
        if(!req.result.objectStoreNames.contains('data'))req.result.createObjectStore('data');
      };
      req.onerror=()=>reject(req.error||new Error('로컬 데이터베이스를 열지 못했습니다.'));
      req.onblocked=()=>reject(new Error('다른 앱 탭이 데이터베이스를 사용 중입니다. 열려 있는 화면을 닫고 다시 시도하세요.'));
      req.onsuccess=()=>resolve(req.result);
    });
  }
  function dbRead(){
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('data','readonly');
      const req=tx.objectStore('data').get(DB_KEY);
      req.onsuccess=()=>resolve(req.result||null);
      req.onerror=()=>reject(req.error||new Error('저장 데이터 읽기 실패'));
      tx.onabort=()=>reject(tx.error||new Error('저장 데이터 읽기 실패'));
    });
  }
  function dbWrite(value){
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('data','readwrite');
      tx.objectStore('data').put(value,DB_KEY);
      tx.oncomplete=resolve;
      tx.onerror=()=>reject(tx.error||new Error('자동 저장 실패'));
      tx.onabort=()=>reject(tx.error||new Error('자동 저장 실패'));
    });
  }
  function cleanCourses(value){
    if(!Array.isArray(value)||value.length<1||value.length>12)throw new Error('백업의 코스 수가 올바르지 않습니다.');
    let previous=-1;
    return value.map((c,i)=>{
      if(!c||typeof c!=='object'||typeof c.name!=='string'||!c.name.trim()||c.name.length>35||
         !Number.isInteger(c.minute)||c.minute<0||c.minute>300||c.minute<=previous||
         !['person','table'].includes(c.unit))throw new Error(`백업의 ${i+1}번 코스 정보가 올바르지 않습니다.`);
      previous=c.minute;
      return {name:c.name.trim(),minute:c.minute,unit:c.unit};
    });
  }
  function validateStore(value){
    if(!value||typeof value!=='object'||!value.rounds||typeof value.rounds!=='object')
      throw new Error('테이블레이 백업 형식이 아닙니다.');
    const rounds={};
    for(const [id,title,date,meal] of SCHEDULE){
      const data=value.rounds[id];
      if(!data||!data.round||!Array.isArray(data.tables)||data.tables.length!==10)
        throw new Error(`${title}의 테이블 자료가 빠져 있습니다.`);
      const r=data.round;
      if(r.id!==id||r.meal!==meal||r.service_date!==date||
         typeof r.planned_start!=='string'||
         (r.planned_start&&!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(r.planned_start)))
        throw new Error(`${title}의 회차 정보가 올바르지 않습니다.`);
      const courses=cleanCourses(r.courses);
      if(courses[0].minute!==0)throw new Error(`${title}의 첫 코스 시간은 0분이어야 합니다.`);
      const duration=r.planned_duration===undefined ? Math.max(90,courses.at(-1).minute+8) : r.planned_duration;
      if(!Number.isInteger(duration)||duration<1||duration>360||duration<=courses.at(-1).minute)
        throw new Error(`${title}의 예정 종료 시간이 올바르지 않습니다.`);
      const seen=new Set();
      const tables=data.tables.map(t=>{
        if(!t||!Number.isInteger(t.number)||t.number<1||t.number>10||seen.has(t.number)||
           typeof t.assigned!=='boolean'||!Number.isInteger(t.party_size)||t.party_size<1||t.party_size>12||
           !['yes','none','unknown'].includes(t.allergy_state)||typeof t.allergy_note!=='string'||t.allergy_note.length>100||
           !Number.isInteger(t.step)||t.step<0||t.step>courses.length||
           (t.started_at!==null&&(!Number.isFinite(t.started_at)||t.started_at<=0||t.started_at>4102444800))||
           (t.step>0&&(t.started_at===null||!t.assigned))||
           (!t.assigned&&t.started_at!==null))throw new Error(`${title} 테이블 정보가 손상되었습니다.`);
        seen.add(t.number);
        const guests=Array.isArray(t.guests)&&t.guests.length===t.party_size&&t.guests.every(g=>
          g&&['duck','wagyu'].includes(g.kind)&&typeof g.cook==='string'&&DONENESS.some(([v])=>v===g.cook)&&
          typeof g.drink==='string'&&DRINKS.some(([v])=>v===g.drink))
          ?t.guests.map(g=>({kind:g.kind,cook:g.kind==='duck'?'':g.cook,drink:g.drink}))
          :makeGuests(t.party_size,meal);
        return {
          number:t.number,assigned:t.assigned,party_size:t.party_size,
          reservation_name:typeof t.reservation_name==='string'?t.reservation_name.trim().slice(0,60)||null:null,
          allergy_state:t.allergy_state,allergy_note:t.allergy_state==='yes'?t.allergy_note:'',
          seated:t.assigned&&(typeof t.seated==='boolean'?t.seated:!!t.started_at),
          started_at:t.started_at,step:t.step,guests,
          updated_at:Number.isFinite(t.updated_at)?t.updated_at:0
        };
      }).sort((a,b)=>a.number-b.number);
      rounds[id]={round:{id,title,service_date:date,meal,planned_start:r.planned_start,planned_duration:duration,
        courses,revision:Number.isInteger(r.revision)?r.revision:0},tables};
    }
    return {activeRound:sessionOrder.includes(value.activeRound)?value.activeRound:'24-l1',rounds};
  }
  function serialize(){
    return {activeRound:app.activeRound,rounds:Object.fromEntries(app.liveByRound)};
  }
  function loadState(data){
    app.liveByRound=new Map(sessionOrder.map(id=>[id,data.rounds[id]]));
    app.activeRound=data.activeRound;
    app.live=app.liveByRound.get(app.activeRound);
    app.rounds=SCHEDULE.map(([id,title,service_date,meal])=>({id,title,service_date,meal}));
  }
  async function start(){
    try{
      db=await openDB();
      let saved=await dbRead();
      if(!saved){
        saved=initialStore();
        await dbWrite(saved);
      }
      const normalized=validateStore(saved);
      // An existing v1 installation has no planned_duration. Preserve all prior data.
      if(Object.values(saved.rounds).some(s=>s.round.planned_duration===undefined||s.tables.some(t=>t.seated===undefined||!Array.isArray(t.guests)))) await dbWrite(normalized);
      loadState(normalized);
      app.authorized=true;
      const picker=$('round-picker');
      picker.replaceChildren();
      for(const round of app.rounds){
        const opt=document.createElement('option');opt.value=round.id;opt.textContent=round.title;picker.append(opt);
      }
      picker.value=app.activeRound;
      $('auth-screen').hidden=true;
      $('app').hidden=false;
      renderBoard();updateStatus();
      const savedConfig=window.TableLaySync?.readConfig();
      if(savedConfig) $('sync-config').value=JSON.stringify(savedConfig,null,2);
      if(window.TableLaySync?.isEnrolled()){
        app.syncActive=true;app.syncIssue='클라우드 연결 확인 중';updateStatus();
        resumeSync().catch(syncFailure);
      }
      if(navigator.storage&&navigator.storage.persist){
        navigator.storage.persist().catch(()=>{});
      }
    }catch(err){
      app.authorized=false;
      $('app').hidden=true;
      $('auth-screen').hidden=false;
      $('auth-heading').textContent='기기 저장소를 사용할 수 없습니다';
      $('auth-subtitle').textContent=err.message+' 사파리 시크릿 모드 또는 저장 공간 설정을 확인하고 다시 열어주세요.';
      $('storage-retry').hidden=false;
    }
  }
  function snapshot() {
    return app.mode === 'demo' ? app.demos.get(app.activeRound) : app.live;
  }
  function nowMs() {
    return app.mode === 'demo' ? snapshot()?.demoTime || Date.now() : Date.now() + app.clockSkew;
  }
  function courseCount() { return snapshot()?.round.courses.length || 0; }
  function firstCourseDateMs(round) {
    if(!round.planned_start)return null;
    const day=new Date(`${round.service_date}T${round.planned_start}:00+09:00`).getTime();
    return Number.isFinite(day)?day:null;
  }
  function dueMs(t, idx) {
    if (!t.started_at || idx >= courseCount()) return Infinity;
    const first=firstCourseDateMs(snapshot().round);
    if(first===null)return Infinity;
    return first+snapshot().round.courses[idx].minute*60000;
  }
  function urgency(t) {
    if (!t.assigned) return 'idle';
    if (t.step >= courseCount()) return 'done';
    if (!t.seated || !t.started_at) return 'reserved';
    const d = dueMs(t, t.step) - nowMs();
    if (!Number.isFinite(d))return 'reserved';
    if (d < -1000) return 'late';
    if (d <= 5 * 60000) return 'soon';
    return 'ok';
  }
  function countText(t) {
    if (!t.assigned) return '예약 대기';
    if (!t.seated) return '착석 대기';
    if (!t.started_at) return '코스 시작 대기';
    if (t.step >= courseCount()) return '전체 완료';
    const due=dueMs(t,t.step);
    if(!Number.isFinite(due))return '시간 미설정';
    const d=Math.ceil((due-nowMs())/60000);
    if(d<0)return `${Math.abs(d)}분 지연`;
    if(d===0)return '지금 서빙';
    return `${d}분 남음`;
  }
  function allergen(t) {
    if (!t.assigned)return '';
    if (t.allergy_state==='yes')return '⚠ '+(t.allergy_note.trim()||'알레르기 확인');
    if (t.allergy_state==='unknown')return '! 알레르기 미확인';
    return '';
  }
  function mainCourseIndex(){
    const list=snapshot().round.courses;
    const found=list.findIndex((c,i)=>i===list.length-1?false:/스테이크|메인|와규|오리/.test(c.name));
    return found>=0?found:Math.max(0,list.length-3);
  }
  function isLastCourse(t){return t.step===courseCount()-1;}
  function drinkSummary(t){
    const buckets=DRINKS.slice(1).map(([code,label])=>[label,t.guests.filter(g=>g.drink===code).length]).filter(x=>x[1]);
    const missing=t.guests.filter(g=>!g.drink).length;
    return {buckets,missing};
  }
  function mainSummary(t){
    const duck=t.guests.filter(g=>g.kind==='duck').length;
    const wagyu=t.guests.filter(g=>g.kind==='wagyu').length;
    const unknown=t.guests.filter(g=>g.kind==='wagyu'&&!g.cook).length;
    return {duck,wagyu,unknown};
  }
  function tableTitle(t){
    const list=snapshot().round.courses;
    if(!t.assigned)return '예약 등록 대기';
    if(!t.seated)return '착석 대기';
    if(!t.started_at)return '코스 시작 대기';
    if(t.step>=list.length)return '전체 코스 완료';
    return list[t.step].name;
  }
  function makeTableCard(number){
    const article=create('article','table-card');
    article.dataset.table=String(number);
    const main=create('button','card-main');
    main.type='button';
    main.addEventListener('click',()=>openTable(number));
    const foot=create('div','card-footer');
    const serve=create('button','serve-action');
    serve.type='button';
    serve.addEventListener('click',()=>{
      const phase=serve.dataset.phase;
      if(phase==='register'){openTable(number);return;}
      return queueTableAdvance(number,phase);
    });
    foot.append(serve);
    article.append(main,foot);
    return article;
  }
  function tablePhase(t){
    return !t.assigned?'register':!t.seated?'seat':!t.started_at?'start':`${t.started_at}:${t.step}`;
  }
  function renderTableCard(article,t){
    article.dataset.state=urgency(t);
    const main=article.querySelector('.card-main');
    const showReservationName=t.assigned&&t.step===0&&t.reservation_name;
    main.setAttribute('aria-label',showReservationName?
      `T${pad(t.number)} ${t.reservation_name} 고객·주문 설정`:`T${pad(t.number)} 고객·주문 설정`);
    const header=create('div','card-header');
    header.append(create('strong','table-number',pad(t.number)));
    if(showReservationName){
      const name=create('span','table-reservation-name',t.reservation_name);
      name.title=t.reservation_name;
      header.append(name);
    }
    const party=create('span','table-party',t.assigned?`${t.party_size}인`:'미등록');
    if(t.assigned&&t.party_size===3)party.classList.add('table-party-three');
    header.append(party);
    const allergy=create('div','table-allergy-slot');
    const warning=allergen(t);
    if(warning)allergy.append(create('span','table-allergy '+t.allergy_state,warning));
    const next=create('div','table-next',tableTitle(t));
    const extras=create('div','table-extras');
    if(t.started_at&&t.step===mainCourseIndex()){
      const info=mainSummary(t);
      const pieces=[];if(info.duck)pieces.push(`오리 ${info.duck}`);if(info.wagyu)pieces.push(`와규 ${info.wagyu}`);
      extras.append(create('strong','meal-count',pieces.join(' · ')));
      if(info.unknown)extras.append(create('span','meal-warning',`⚠ 와규 굽기 미확인 ${info.unknown}명`));
    }else if(t.started_at&&isLastCourse(t)){
      const info=drinkSummary(t);
      info.buckets.forEach(([label,n])=>extras.append(create('strong','drink-count',`${label} ${n}`)));
      if(info.missing)extras.append(create('span','meal-warning',`⚠ 음료 미선택 ${info.missing}명`));
    }
    // Remind staff about missing doneness before the main is called, too.
    if(t.assigned&&t.started_at&&t.step===mainCourseIndex()-1&&mainSummary(t).unknown)extras.append(create('span','meal-warning subtle-warning',`와규 굽기 미확인 ${mainSummary(t).unknown}명`));
    const counter=create('div','table-time',countText(t));counter.dataset.countFor=String(t.number);
    const track=create('div','course-track');
    snapshot().round.courses.forEach((_,i)=>{
      const dot=create('i',i<t.step&&t.started_at?'completed':i===t.step&&t.started_at?'current':'');track.append(dot);
    });
    main.replaceChildren(header,allergy,next,extras,counter,track);
    const label=!t.assigned?'예약 등록':!t.seated?'착석 완료':!t.started_at?'코스 시작':t.step>=courseCount()?'전체 완료':'서빙 완료';
    const serve=article.querySelector('.serve-action');
    if(serve.textContent!==label)serve.textContent=label;
    serve.disabled=t.assigned&&t.step>=courseCount();
    serve.dataset.phase=tablePhase(t);
  }
  const cardContents=new WeakMap();
  function renderTables() {
    const data = snapshot();
    if (!data) return;
    const upper = $('table-row-top'), lower = $('table-row-bottom');
    if(!upper.children.length){
      upper.append(...[10,9,8,7,6].map(makeTableCard));
      lower.append(...[5,4,3,2,1].map(makeTableCard));
    }
    const lookup = new Map(data.tables.map((t) => [t.number, t]));
    const schedule=JSON.stringify([data.round.id,data.round.planned_start,data.round.courses]);
    for(const card of [...upper.children,...lower.children]){
      const number=Number(card.dataset.table);
      const table=app.pendingTables.get(number)?.preview||lookup.get(number);
      const contents=schedule+JSON.stringify(table);
      if(cardContents.get(card)!==contents){
        renderTableCard(card,table);
        cardContents.set(card,contents);
      }else{
        card.dataset.state=urgency(table);
        const counter=card.querySelector('.table-time');
        const remaining=countText(table);
        if(counter.textContent!==remaining)counter.textContent=remaining;
      }
    }
    app.prevStatus = new Map(data.tables.map((t) => [t.number, urgency(t)]));
  }
  function quantityFor(t, course) { return course.unit === 'table' ? 1 : t.party_size; }
  function renderQuantities(){
    const data=snapshot();if(!data)return;
    const amounts=new Map();let grand=0;
    function add(name,num){if(!num)return;amounts.set(name,(amounts.get(name)||0)+num);grand+=num;}
    data.tables.forEach(t=>{
      // Only the next serving course of a started table is counted.
      if(!t.assigned||!t.started_at||t.step>=courseCount())return;
      if(t.step===mainCourseIndex()){
        const info=mainSummary(t);add('오리',info.duck);add('와규',info.wagyu);
      }else if(isLastCourse(t)){
        drinkSummary(t).buckets.forEach(([name,qty])=>add(name,qty));
      }else add(data.round.courses[t.step].name,quantityFor(t,data.round.courses[t.step]));
    });
    const host=$('quantity-list');host.replaceChildren();
    amounts.forEach((num,name)=>{
      const chip=create('div','quantity-chip');chip.append(create('span','chip-name',name),create('strong','chip-count',`${num}`));host.append(chip);
    });
    $('quantity-grand').textContent=`${grand}개`;
    if(!amounts.size)host.append(create('span','quantity-placeholder','현재 진행 중인 요리가 없습니다.'));
  }
  function renderHeader() {
    const data = snapshot();
    if (!data) return;
    $('clock').textContent = prettyTime(nowMs());
    $('planned-start').textContent = data.round.planned_start ? `예정 ${data.round.planned_start}` : '시작 시간 미설정';
    $('active-count').textContent = data.tables.filter(t => t.started_at && t.step < courseCount()).length;
    $('late-count').textContent = data.tables.filter(t => urgency(t) === 'late').length;
    $('board-description').textContent = `${data.round.meal === 'lunch' ? '런치' : '디너'} · ${courseCount()}코스`;
    const due = data.tables
      .filter(t => t.assigned && t.started_at && t.step < courseCount())
      .map(t => ({t,delta:dueMs(t,t.step)-nowMs()}))
      .filter(x => x.delta <= 0)
      .sort((a,b) => a.delta-b.delta).slice(0,3);
    $('queue-message').textContent = due.length ?
      '서빙 우선 · ' + due.map(({t,delta}) => `T${pad(t.number)} ${data.round.courses[t.step].name} ${delta < -60000 ? Math.ceil(-delta/60000)+'분 지연' : '지금'}`).join('  ·  ') :
      '현재 서빙 예정 시각을 넘긴 테이블이 없습니다.';
  }
  function renderBoard() {
    if (!snapshot()) return;
    renderTables(); renderQuantities(); renderHeader();
    if (app.mode === 'demo') $('demo-time').textContent = prettyTime(nowMs());
  }
  function tick() {
    if (!app.authorized || !snapshot()) return;
    $('clock').textContent = prettyTime(nowMs());
    const changed = [];
    snapshot().tables.forEach(saved => {
      const t=app.pendingTables.get(saved.number)?.preview||saved;
      const s = urgency(t), old = app.prevStatus.get(t.number);
      const card = document.querySelector(`.table-card[data-table="${t.number}"]`);
      if (card) {
        card.dataset.state = s;
        const countdown = card.querySelector('[data-count-for]');
        if (countdown) countdown.textContent = countText(t);
        if (s !== old && (s === 'soon' || s === 'late')) {
          card.classList.remove('alert-flash');
          void card.offsetWidth;
          card.classList.add('alert-flash');
          card.addEventListener('animationend', () => card.classList.remove('alert-flash'), {once:true});
        }
      }
      if (s !== old) changed.push(t.number);
      app.prevStatus.set(t.number,s);
    });
    renderHeader();
    const minute = Math.floor(nowMs()/60000);
    if (minute !== app.lastMinute || changed.length) {
      app.lastMinute=minute;
      renderQuantities();
    }
  }
  function makeDemo(real) {
    const src=JSON.parse(JSON.stringify(real));
    const isLunch=src.round.meal==='lunch';
    const hhmm=isLunch?'12:45':'18:45';
    const date=src.round.service_date;
    const demoNow=new Date(`${date}T${hhmm}:00+09:00`).getTime();
    const steps=[4,2,3,1,Math.min(5,src.round.courses.length-1),4,Math.min(6,src.round.courses.length-1),2,0,0];
    const shift=[-3,4,0,7,12,5,9,-1];
    const people=[3,2,2,3,2,3,2,2,2,2];
    src.tables=src.tables.map((t,i)=>{
      const assigned=i<8;
      const step=assigned?Math.min(steps[i],src.round.courses.length-1):0;
      return {
        number:i+1,assigned,party_size:people[i],
        allergy_state:i===2||i===6?'yes':i===1||i===5?'unknown':'none',
        allergy_note:i===2?'갑각류':i===6?'견과류':'',
        seated:assigned,started_at:assigned?demoNow/1000:null,
        step,guests:makeGuests(people[i],src.round.meal),updated_at:0
      };
    });
    src.round.planned_start=hhmm.slice(0,3)+'00';
    src.demoTime=demoNow;
    return src;
  }

  async function changeMode(){
    if(!app.authorized||app.busy||app.pendingTables.size||$('settings-dialog').open||$('table-dialog').open)return;
    if(app.mode==='live'){
      app.mode='demo';
      if(!app.demos.has(app.activeRound))app.demos.set(app.activeRound,makeDemo(app.live));
    }else{
      app.mode='live';app.live=app.liveByRound.get(app.activeRound);
    }
    $('practice-bar').hidden=app.mode!=='demo';
    $('practice-toggle').textContent=app.mode==='demo'?'실제 운영으로 돌아가기':'연습 모드';
    $('practice-toggle').classList.toggle('active',app.mode==='demo');
    app.prevStatus=new Map();
    updateStatus();renderBoard();
  }
  // The live mode writes one atomic Firestore transaction per user action.
  // The server compares changed fields against the values this tablet saw;
  // different tables can change concurrently, but stale double-serve cannot skip a course.
  async function mutate(_path,_data,localAction){
    if(app.busy)return null;
    if(app.remoteApplying&&app.mode==='live'){toast('동기화 중입니다. 다시 눌러주세요.',true);return null;}
    if(app.mode==='demo'){
      localAction?.();renderBoard();return snapshot();
    }
    if(typeof localAction!=='function')throw new Error('저장할 변경 내용이 없습니다.');
    if(app.syncActive&&(!navigator.onLine||!window.TableLaySync.isReady()||app.syncIssue)){
      toast('클라우드 연결이 끊겼습니다. 재연결 후 다시 눌러주세요.',true);updateStatus();return null;
    }
    const before=JSON.parse(JSON.stringify(serialize()));
    app.busy=true;updateStatus();
    try{
      localAction();
      app.live.round.revision=(app.live.round.revision||0)+1;
      if(app.syncActive){
        const committed=await window.TableLaySync.transact(before,serialize());
        const normalized=validateStore(committed);
        const deviceRound=app.activeRound;
        loadState(normalized);app.activeRound=deviceRound;app.live=app.liveByRound.get(deviceRound);
        await dbWrite(serialize());
      }else{
        await dbWrite(serialize());
      }
      renderBoard();
      return snapshot();
    }catch(err){
      loadState(validateStore(before));
      renderBoard();
      toast((err.isConflict?'동시 변경 충돌: ':'저장 실패: ')+err.message,true);
      if(app.syncActive)refreshRemoteAfterConflict().catch(()=>{});
      return null;
    }finally{
      app.busy=false;
      if(app.remoteQueued){const incoming=app.remoteQueued;app.remoteQueued=null;applyRemote(incoming).catch(()=>{});}
      updateStatus();
      drainBoardActions().catch(syncFailure);
    }
  }

  async function applyRemote(raw){
    if(!app.syncActive)return;
    if(app.busy||app.remoteApplying){app.remoteQueued=raw;return;}
    app.remoteApplying=true;
    try{
      const normalized=validateStore(raw);
      const deviceRound=app.activeRound;
      loadState(normalized);
      app.activeRound=deviceRound;app.live=app.liveByRound.get(deviceRound);
      await dbWrite(serialize());
      app.syncIssue=null;
      if(app.mode==='live')renderBoard();
      updateStatus();
    }catch(e){app.syncIssue=e.message;updateStatus();toast('클라우드 데이터 오류: '+e.message,true);}
    finally{
      app.remoteApplying=false;
      if(app.remoteQueued){const latest=app.remoteQueued;app.remoteQueued=null;applyRemote(latest).catch(syncFailure);}
      drainBoardActions().catch(syncFailure);
    }
  }
  async function refreshRemoteAfterConflict(){
    if(!app.syncActive)return;
    const fresh=await window.TableLaySync.readCloud();
    if(fresh)await applyRemote(fresh);
  }
  function syncMessage(message,error=false){
    $('sync-message').textContent=message;
    $('sync-message').classList.toggle('error',error);
  }
  function syncFailure(err){
    app.syncIssue=err.message||String(err);
    syncMessage('연결 문제: '+app.syncIssue,true);
    updateStatus();
  }
  async function attachCloud(raw){
    const normalized=validateStore(raw);
    app.syncActive=true;
    app.syncIssue='클라우드 데이터 적용 중';
    await applyRemote(normalized);
    window.TableLaySync.attach(incoming=>{applyRemote(incoming).catch(syncFailure);},syncFailure);
    window.TableLaySync.setEnrolled(true);
    syncMessage('실시간 연동 시작 · 두 태블릿이 같은 데이터 공유');
    $('sync-decisions').hidden=true;
    $('sync-password').value='';
    updateStatus();
  }
  async function resumeSync(){
    try{
      const cfg=window.TableLaySync.readConfig();
      if(!cfg)throw new Error('Firebase 프로젝트 설정이 없습니다. 태블릿 연동에서 다시 입력하세요.');
      await window.TableLaySync.initialize(cfg);
      await window.TableLaySync.restoreLogin();
      const cloud=await window.TableLaySync.readCloud();
      if(!cloud)throw new Error('클라우드 자료가 없습니다. 태블릿 연동 메뉴를 확인하세요.');
      await attachCloud(cloud);
    }catch(e){syncFailure(e);}
  }
  async function syncLogin(){
    if(app.syncChecking)return;
    if(app.syncActive&&!app.syncIssue){syncMessage('이미 연동 중입니다.');return;}
    app.syncChecking=true;$('sync-login').disabled=true;
    try{
      if(app.mode==='demo')throw new Error('실제 운영 모드로 돌아와서 연결하세요.');
      const config=JSON.parse($('sync-config').value);
      await window.TableLaySync.initialize(config);
      const uid=await window.TableLaySync.login($('sync-email').value,$('sync-password').value);
      $('sync-uid').hidden=false;
      $('sync-uid').textContent='로그인 UID: '+uid+' · Firestore 보안 규칙의 UID와 같아야 합니다.';
      const cloud=await window.TableLaySync.readCloud();
      $('sync-decisions').hidden=false;
      $('sync-seed').hidden=cloud!==null;
      $('sync-join').hidden=cloud===null;
      $('sync-cloud-state').textContent=cloud===null?
        '클라우드가 비어 있습니다. 첫 번째 태블릿의 데이터를 처음 업로드할 수 있습니다. 기존 데이터는 먼저 JSON 백업하세요.':
        '공유 운영 데이터가 이미 있습니다. 이 태블릿의 기존 로컬 데이터는 클라우드 내용으로 교체됩니다. 중요한 로컬 데이터는 먼저 JSON 백업하세요.';
      syncMessage('로그인 성공 · '+(cloud?'클라우드 데이터 발견':'클라우드 데이터 없음'));
    }catch(e){syncMessage('로그인/조회 실패: '+e.message,true);}
    finally{app.syncChecking=false;$('sync-login').disabled=false;}
  }
  async function syncSeed(){
    if(!window.confirm('첫 태블릿의 현재 7개 회차 데이터를 클라우드에 처음 업로드합니다. 기존 JSON 백업을 저장했나요?'))return;
    $('sync-seed').disabled=true;
    try{await window.TableLaySync.firstUpload(serialize());await attachCloud(await window.TableLaySync.readCloud());toast('최초 데이터 업로드 · 실시간 연동 시작');}
    catch(e){syncMessage('최초 업로드 실패: '+e.message,true);}
    finally{$('sync-seed').disabled=false;}
  }
  async function syncJoin(){
    if(!window.confirm('이 태블릿의 현재 로컬 운영 데이터가 클라우드 데이터로 교체됩니다. 기존 JSON 백업을 저장했나요?'))return;
    $('sync-join').disabled=true;
    try{const remote=await window.TableLaySync.readCloud();if(!remote)throw new Error('클라우드 데이터가 없습니다.');await attachCloud(remote);toast('클라우드 데이터 연결 완료');}
    catch(e){syncMessage('연동 실패: '+e.message,true);}
    finally{$('sync-join').disabled=false;}
  }
  async function syncDisconnect(){
    if(!window.confirm('이 태블릿을 클라우드 연동에서 해제하시겠습니까? 이후의 로컬 조작은 다른 태블릿에 반영되지 않습니다.'))return;
    window.TableLaySync.detach();
    await window.TableLaySync.signOut();
    app.syncActive=false;app.syncIssue=null;app.remoteQueued=null;
    window.TableLaySync.setEnrolled(false);
    $('sync-decisions').hidden=true;$('sync-uid').hidden=true;
    syncMessage('연동 해제됨 · 이 기기에만 저장');updateStatus();
  }
  function advanceTable(table, pressedAt, startedAt) {
    if(!table.seated)table.seated=true;
    else if(!table.started_at)table.started_at=startedAt;
    else table.step++;
    table.updated_at=pressedAt;
  }

  function queueTableAdvance(number,phase) {
    const table=snapshot()?.tables.find(t=>t.number===number);
    if(app.pendingTables.has(number)||!table?.assigned||tablePhase(table)!==phase||table.step>=courseCount())return;
    const pressedAt=Date.now()/1000, startedAt=nowMs()/1000;
    const preview={...table};
    advanceTable(preview,pressedAt,startedAt);
    const saved=new Promise(resolve=>{
      app.pendingTables.set(number,{number,phase,pressedAt,startedAt,preview,resolve});
    });
    const card=document.querySelector(`.table-card[data-table="${number}"]`);
    if(card){
      renderTableCard(card,preview);
      cardContents.delete(card);
    }
    if(app.boardSaveTimer===null){
      app.boardSaveTimer=setTimeout(()=>{
        app.boardSaveTimer=null;
        drainBoardActions().catch(syncFailure);
      },40);
    }
    return saved;
  }

  async function drainBoardActions(){
    if(app.busy||app.remoteApplying||app.boardSaving||app.boardSaveTimer!==null||!app.pendingTables.size)return;
    const batch=[...app.pendingTables.values()];
    const tables=snapshot().tables;
    const changes=batch.map(action=>({action,table:tables.find(t=>t.number===action.number)}))
      .filter(({action,table})=>table?.assigned&&tablePhase(table)===action.phase&&table.step<courseCount());
    let result=null;
    app.boardSaving=true;
    try{
      if(changes.length){
        result=await mutate(null,null,()=>{
          for(const {action,table} of changes)advanceTable(table,action.pressedAt,action.startedAt);
        });
      }
      if(changes.length!==batch.length)toast('다른 기기에서 바뀐 테이블이 있습니다. 현재 단계를 확인해 주세요.',true);
    }finally{
      app.boardSaving=false;
      for(const action of batch)app.pendingTables.delete(action.number);
      renderBoard();
      for(const action of batch)action.resolve(!!result&&changes.some(change=>change.action===action));
      if(app.pendingTables.size)drainBoardActions().catch(syncFailure);
    }
  }

  async function seatAll(){
    const tables=snapshot().tables.filter(t=>t.assigned&&!t.seated&&!app.pendingTables.has(t.number));
    if(!tables.length){toast('착석 대기 중인 등록 테이블이 없습니다.');return;}
    const saved=await Promise.all(tables.map(t=>queueTableAdvance(t.number,tablePhase(t))));
    const count=saved.filter(Boolean).length;
    if(count)toast(`${count}개 테이블 착석 완료 · 코스 시작은 각 테이블에서 누르세요.`);
  }
  function syncGuestControls(){
    const host=$('guest-order-list');host.replaceChildren();
    const isLunch=snapshot().round.meal==='lunch';
    for(let j=0;j<app.editGuests.length;j++){
      const guest=app.editGuests[j],row=create('div','guest-order-row');
      row.append(create('strong','guest-number',`${j+1}인`));
      const kind=create('select','guest-kind');
      [['duck','오리'],['wagyu','와규']].forEach(([v,label])=>{const opt=create('option','',label);opt.value=v;kind.append(opt);});
      kind.value=guest.kind;
      const doneness=create('select','guest-cook');
      DONENESS.forEach(([v,label])=>{const opt=create('option','',label);opt.value=v;doneness.append(opt);});
      doneness.value=guest.cook;doneness.disabled=guest.kind!=='wagyu';
      const drink=create('select','guest-drink');
      DRINKS.forEach(([v,label])=>{const opt=create('option','',label);opt.value=v;drink.append(opt);});
      drink.value=guest.drink;
      kind.addEventListener('change',()=>{guest.kind=kind.value;if(guest.kind==='duck')guest.cook='';syncGuestControls();});
      doneness.addEventListener('change',()=>{guest.cook=doneness.value;syncGuestControls();});
      drink.addEventListener('change',()=>{guest.drink=drink.value;syncGuestControls();});
      row.append(kind,doneness,drink);host.append(row);
    }
    const n=app.editGuests.filter(g=>g.kind==='wagyu'&&!g.cook).length;
    $('guest-warning').textContent=n?`⚠ 와규 ${n}명 굽기 미확인 · 조리 전에 확인하세요.`:'';
    $('guest-dining-note').textContent=isLunch?'런치 기본 오리 · 와규 예약 변경은 인원별 선택':'디너 기본 와규 · 인원별 굽기 선택';
  }
  function openTable(number) {
    const t=snapshot()?.tables.find(x=>x.number===number);
    if (!t) return;
    app.editingTable=number;
    app.editParty=t.party_size;
    app.editGuests=JSON.parse(JSON.stringify(t.guests));
    syncGuestControls();
    $('table-modal-title').textContent=`TABLE ${pad(number)}`;
    $('table-assigned').checked=t.assigned || !t.started_at;
    $('party-value').textContent=`${app.editParty}명`;
    $('party-minus').disabled=app.editParty<=1;
    $('party-plus').disabled=app.editParty>=12;
    $('reservation-name').value=t.reservation_name||'';
    $('allergy-status').value=t.allergy_state;
    $('allergy-note').value=t.allergy_note;
    $('allergy-note').disabled=t.allergy_state!=='yes';
    $('table-undo').disabled=!t.started_at&& !t.seated;
    $('table-clear').disabled=!t.assigned && !t.started_at;
    $('table-assigned').disabled=!!t.started_at;
    $('table-next-explanation').textContent=t.step>=courseCount()?'전체 코스가 완료되었습니다.':
      t.started_at?`다음 예정 ${Number.isFinite(dueMs(t,t.step))?prettyTime(dueMs(t,t.step)):'시간 미설정'} · ${snapshot().round.courses[t.step].name}`:
      t.seated?'착석 완료 · 코스 시작 대기':'착석 대기 · 코스 시작과 별도 관리';
    $('table-dialog').showModal();
  }
  function adjustParty(delta) {
    app.editParty=Math.min(12,Math.max(1,app.editParty+delta));
    while(app.editGuests.length<app.editParty)app.editGuests.push({kind:snapshot().round.meal==='lunch'?'duck':'wagyu',cook:'',drink:''});
    app.editGuests.length=app.editParty;
    syncGuestControls();
    $('party-value').textContent=`${app.editParty}명`;
    $('party-minus').disabled=app.editParty<=1;
    $('party-plus').disabled=app.editParty>=12;
  }
  async function saveTable(event) {
    event.preventDefault();
    const number=app.editingTable;
    const t=snapshot()?.tables.find(x=>x.number===number);
    if (!t) return;
    const details={
      party_size:app.editParty,assigned:$('table-assigned').checked,
      reservation_name:$('reservation-name').value.trim().slice(0,60)||t.reservation_name||null,
      allergy_state:$('allergy-status').value,
      allergy_note:$('allergy-note').value.trim(),guests:JSON.parse(JSON.stringify(app.editGuests))
    };
    if (details.allergy_state==='yes' && !details.allergy_note) {
      toast('알레르기 종류를 입력하세요.',true);$('allergy-note').focus();return;
    }
    const result=await mutate(null,null,()=>{
      Object.assign(t,details);
      if(!t.assigned){t.seated=false;t.started_at=null;t.step=0;}
      t.updated_at=Date.now()/1000;
    });
    if (result) {$('table-dialog').close(); toast(`T${pad(number)} 고객 정보가 저장되었습니다.`);}
  }
  async function undoCourse() {
    const number=app.editingTable;
    const t=snapshot()?.tables.find(x=>x.number===number);
    if(!t||(!t.started_at&&!t.seated))return;
    const result=await mutate(null,null,()=>{
      if(t.started_at&&t.step>0)t.step--;
      else if(t.started_at){t.started_at=null;t.step=0;}
      else t.seated=false;
    });
    if (result) {$('table-dialog').close();toast(`T${pad(number)} 이전 코스로 되돌렸습니다.`);}
  }
  async function clearTable() {
    const number=app.editingTable;
    if (!window.confirm(`T${pad(number)}의 예약자 이름, 인원, 알레르기 및 서빙 기록을 모두 비울까요?`))return;
    const t=snapshot()?.tables.find(x=>x.number===number);
    const result=await mutate(null,null,()=>{
      Object.assign(t,{assigned:false,party_size:2,reservation_name:null,allergy_state:'unknown',allergy_note:'',started_at:null,seated:false,step:0,guests:makeGuests(2,snapshot().round.meal),updated_at:Date.now()/1000});
    });
    if (result) {$('table-dialog').close();toast(`T${pad(number)} 테이블을 비웠습니다.`);}
  }

  function setSettingsPane(pane){
    const isMenu=pane==='menu';
    $('menu-config-pane').hidden=!isMenu;
    $('time-config-pane').hidden=isMenu;
    $('menu-tab').classList.toggle('is-active',isMenu);
    $('time-tab').classList.toggle('is-active',!isMenu);
    $('menu-tab').setAttribute('aria-selected',String(isMenu));
    $('time-tab').setAttribute('aria-selected',String(!isMenu));
  }
  function roundsOfMeal(meal){
    return SCHEDULE.filter(([, , ,kind])=>kind===meal).map(([id])=>app.liveByRound.get(id));
  }
  function mealSource(meal){return roundsOfMeal(meal)[0].round.courses;}
  function renderCourseEditor() {
    const host=$('course-editor');
    host.replaceChildren();
    const labels=create('div','course-editor-heading meal-heading');
    ['순서','요리 이름','수량 기준',''].forEach(x=>labels.append(create('span','',x)));
    host.append(labels);
    mealSource(app.configMeal).forEach((c,i)=>addCourseRow(c,i));
    $('settings-meal-picker').value=app.configMeal;
    $('menu-scope-note').textContent=app.configMeal==='lunch' ?
      '런치 공통 · 12/24 1부, 12/25 1부·2부에 적용' :
      '디너 공통 · 12/24 1부·2부, 12/25 1부·2부에 적용';
  }
  function addCourseRow(course,index) {
    const host=$('course-editor');
    const row=create('div','course-row meal-row');
    const number=create('span','course-index',pad(index+1));
    const name=create('input','course-name');
    name.type='text';name.maxLength=35;name.value=course.name;name.placeholder='요리 이름';name.required=true;
    name.setAttribute('aria-label',`${index+1}코스 이름`);
    const unit=create('select','course-unit');
    [['person','1인당 1개'],['table','테이블당 1개']].forEach(([value,label])=>{
      const option=create('option','',label);option.value=value;unit.append(option);
    });
    unit.value=course.unit;
    unit.setAttribute('aria-label',`${index+1}코스 수량 기준`);
    const remove=create('button','course-remove','×');remove.type='button';remove.title='코스 삭제';
    remove.setAttribute('aria-label',`${index+1}코스 삭제`);
    remove.addEventListener('click',()=>{
      if(host.querySelectorAll('.course-row').length<=1){toast('최소 1개 코스가 필요합니다.',true);return;}
      row.remove();reindexCourses();
    });
    row.append(number,name,unit,remove);host.append(row);
  }
  function reindexCourses() {
    const rows=$('course-editor').querySelectorAll('.course-row');
    rows.forEach((row,i)=>{
      row.querySelector('.course-index').textContent=pad(i+1);
      row.querySelector('.course-name').setAttribute('aria-label',`${i+1}코스 이름`);
    });
  }
  function readMenuCourses() {
    const rows=[...$('course-editor').querySelectorAll('.course-row')];
    if(!rows.length||rows.length>12)throw Error('코스 수는 1~12개여야 합니다.');
    const courses=rows.map((row,i)=>({
      name:row.querySelector('.course-name').value.trim(),
      unit:row.querySelector('.course-unit').value
    }));
    courses.forEach((c,i)=>{
      if(!c.name||c.name.length>35)throw Error(`${i+1}번 코스명을 1~35자로 입력하세요.`);
      if(!['table','person'].includes(c.unit))throw Error(`${i+1}번 코스 수량 기준을 확인하세요.`);
    });
    return courses;
  }
  function remapMinutes(previous,courses){
    // Match retained names first so removing a course does not change remaining courses' intended time.
    const taken=new Set();
    const resolved=[];
    for(let i=0;i<courses.length;i++){
      const wanted=courses[i];
      let index=previous.findIndex((c,j)=>!taken.has(j)&&c.name===wanted.name);
      if(index<0&&i<previous.length&&!taken.has(i))index=i; // renamed course
      const oldValue=index>=0?previous[index].minute:null;
      if(index>=0)taken.add(index);
      const minimum=i===0?0:resolved[i-1]+1;
      const minute=i===0?0:oldValue===null?minimum+9:Math.max(minimum,oldValue);
      if(minute>300)throw Error('코스 시간이 300분을 초과합니다. 회차별 시간에서 조정하세요.');
      resolved.push(minute);
    }
    return resolved;
  }
  async function saveMenu(){
    if(app.mode==='demo'){toast('실제 운영 모드에서 코스 구성을 수정하세요.',true);return;}
    let courses;
    try{courses=readMenuCourses();}catch(err){toast(err.message,true);return;}
    const targets=roundsOfMeal(app.configMeal);
    for(const target of targets){
      if(target.tables.some(t=>t.step>0)&&target.round.courses.length!==courses.length){
        toast(`${target.round.title}은 진행 중입니다. 코스 수 변경은 해당 회차 종료 후 가능합니다.`,true);return;
      }
    }
    const result=await mutate(null,null,()=>{
      for(const target of targets){
        const minutes=remapMinutes(target.round.courses,courses);
        target.round.courses=courses.map((c,i)=>({...c,minute:minutes[i]}));
        target.round.planned_duration=Math.max(target.round.planned_duration||90,minutes.at(-1)+8);
        target.round.revision++;
      }
    });
    if(result){
      app.demos.clear();
      renderCourseEditor();renderTimeEditor();
      toast(`${app.configMeal==='lunch'?'런치':'디너'} 공통 코스가 ${targets.length}개 회차에 적용되었습니다.`);
    }
  }
  function fillRoundSelectors(){
    for(const id of ['time-round-picker','timetable-round-picker']){
      const host=$(id);host.replaceChildren();
      for(const [key,title] of SCHEDULE){
        const opt=create('option','',title);opt.value=key;host.append(opt);
      }
    }
  }
  function formatSessionTime(start,minutes){
    if(!start)return '미정';
    const [hours,m]=start.split(':').map(Number);
    const total=(hours*60+m+minutes)%(24*60);
    return `${pad(Math.floor(total/60))}:${pad(total%60)}`;
  }
  function renderTimeEditor(){
    const target=app.liveByRound.get(app.timeRound);if(!target)return;
    $('time-round-picker').value=app.timeRound;
    $('settings-start').value=target.round.planned_start||'';
    $('settings-duration').value=target.round.planned_duration||90;
    const host=$('time-course-editor');host.replaceChildren();
    const heading=create('div','time-course-heading');
    ['순서','코스명','서빙 시각'].forEach(x=>heading.append(create('span','',x)));
    host.append(heading);
    target.round.courses.forEach((c,i)=>{
      const row=create('div','time-course-row');
      const index=create('strong','course-index',pad(i+1));
      const name=create('span','time-course-name',c.name);
      const input=create('input','time-clock');input.type='time';input.required=true;
      input.value=formatSessionTime(target.round.planned_start||(target.round.meal==='lunch'?'12:00':'18:00'),c.minute);
      input.setAttribute('aria-label',`${i+1}코스 ${c.name} 제공 시각`);
      if(i===0)input.addEventListener('change',()=>{$('settings-start').value=input.value;});
      row.append(index,name,input);host.append(row);
    });
  }
  function refreshTimePreview(){
    // Time settings are entered as absolute serving times; no offset preview needed.
  }
  function readTimeSettings(){
    const rows=[...$('time-course-editor').querySelectorAll('.time-clock')];
    const first=rows[0]?.value;
    if(!first)throw Error('첫 코스의 실제 서빙 시각을 입력하세요.');
    const firstMinutes=Number(first.slice(0,2))*60+Number(first.slice(3,5));
    const minutes=rows.map((input,i)=>{
      if(!input.value)throw Error(`${i+1}번 코스의 서빙 시각을 입력하세요.`);
      const time=Number(input.value.slice(0,2))*60+Number(input.value.slice(3,5));
      const delta=time-firstMinutes;
      if(delta<0||delta>300)throw Error('코스 서빙 시각은 첫 요리부터 300분 안에서 순서대로 입력하세요.');
      return delta;
    });
    for(let i=1;i<minutes.length;i++)if(minutes[i]<=minutes[i-1])throw Error('코스 서빙 시각은 이전 코스보다 늦어야 합니다.');
    const duration=Math.max(90,minutes.at(-1)+8);
    if(duration>360)throw Error('코스 종료 예정 시간이 360분을 넘습니다.');
    return{start:first,duration,minutes};
  }
  async function saveTimes(){
    if(app.mode==='demo'){toast('실제 운영 모드에서 회차 시간을 수정하세요.',true);return;}
    let settings;
    try{settings=readTimeSettings();}catch(err){toast(err.message,true);return;}
    const target=app.liveByRound.get(app.timeRound);
    const result=await mutate(null,null,()=>{
      target.round.planned_start=settings.start;
      target.round.planned_duration=settings.duration;
      target.round.courses.forEach((c,i)=>{c.minute=settings.minutes[i]});
      target.round.revision++;
    });
    if(result){
      app.demos.delete(app.timeRound);
      toast(`${target.round.title}의 시간표가 저장되었으며 메인 현황에도 적용됩니다.`);
      if($('timetable-dialog').open)renderTimetable();
    }
  }
  function openSettings(){
    if(app.mode==='demo'){toast('설정 편집은 실제 운영 모드에서 이용하세요.',true);return;}
    app.configMeal=app.live.round.meal;
    app.timeRound=app.activeRound;
    renderCourseEditor();renderTimeEditor();setSettingsPane('menu');
    $('settings-dialog').showModal();
  }
  function timetableRows(id){
    const round=app.liveByRound.get(id).round;
    return {round,rows:round.courses.map((course,i)=>({
      no:i+1,name:course.name,minute:course.minute,
      at:formatSessionTime(round.planned_start,course.minute),
      unit:course.unit==='table'?'테이블당 1개':'1인당 1개'
    })),ending:formatSessionTime(round.planned_start,round.planned_duration)};
  }
  function timetableDataText(id){
    const {round,rows,ending}=timetableRows(id);
    return [`TABLE LAY | ${round.title}`,`시작: ${round.planned_start||'미정'}  ·  종료: ${ending} (총 ${round.planned_duration}분)`,
      '순서 | 제공 시각 | 시작 후 | 코스 | 수량 기준',
      ...rows.map(r=>`${pad(r.no)} | ${r.at} | +${r.minute}분 | ${r.name} | ${r.unit}`),
      `종료 | ${ending} | +${round.planned_duration}분 | 코스 종료`].join('\n');
  }
  function renderTimetable(){
    $('timetable-round-picker').value=app.timetableRound;
    const {round,rows,ending}=timetableRows(app.timetableRound);
    const host=$('timetable-sheet');host.replaceChildren();
    const eyebrow=create('div','tt-eyebrow','TABLE LAY · CHRISTMAS');
    const title=create('h3','tt-title',`${round.title} 타임테이블`);
    const meta=create('div','tt-meta',`시작 ${round.planned_start||'미정'}  ·  종료 ${ending}  ·  총 ${round.planned_duration}분`);
    const table=create('table','tt-table');
    const thead=create('thead','');const thRow=create('tr','');
    ['순서','서빙 시각','시작 후','코스 구성','수량 기준'].forEach(str=>thRow.append(create('th','',str)));
    thead.append(thRow);table.append(thead);
    const body=create('tbody','');
    rows.forEach(row=>{
      const tr=create('tr','');
      [pad(row.no),row.at,`+${row.minute}분`,row.name,row.unit].forEach(str=>tr.append(create('td','',str)));
      body.append(tr);
    });
    const endRow=create('tr','tt-end-row');
    ['—',ending,`+${round.planned_duration}분`,'코스 종료','—'].forEach(str=>endRow.append(create('td','',str)));
    body.append(endRow);table.append(body);
    host.append(eyebrow,title,meta,table,create('div','tt-footer','TABLE LAY · COURSE SERVICE TIMETABLE'));
  }
  function openTimetable(id){
    if(id&&sessionOrder.includes(id))app.timetableRound=id;
    else app.timetableRound=app.activeRound;
    renderTimetable();
    $('timetable-dialog').showModal();
  }
  function downloadFile(blob,filename){
    const url=URL.createObjectURL(blob);
    const anchor=document.createElement('a');anchor.href=url;anchor.download=filename;
    document.body.append(anchor);anchor.click();anchor.remove();
    setTimeout(()=>URL.revokeObjectURL(url),12000);
  }
  async function copyTimetable(){
    const value=timetableDataText(app.timetableRound);
    try{
      if(!navigator.clipboard?.writeText)throw Error('clipboard not supported');
      await navigator.clipboard.writeText(value);
      toast('타임테이블을 복사했습니다. 팀원 채팅에 붙여 넣으세요.');
    }catch(err){toast('텍스트 복사가 지원되지 않습니다. 이미지 저장 또는 인쇄/PDF를 이용하세요.',true);}
  }
  function drawTimetableImage(id){
    const {round,rows,ending}=timetableRows(id);
    const scale=2,width=900,padX=48,top=54,rowHeight=54;
    const logicalHeight=240+(rows.length+1)*rowHeight+60;
    const canvas=document.createElement('canvas');canvas.width=width*scale;canvas.height=logicalHeight*scale;
    const ctx=canvas.getContext('2d');
    if(!ctx)throw Error('이미지 생성 기능을 사용할 수 없습니다.');
    ctx.scale(scale,scale);ctx.fillStyle='#fcfaf6';ctx.fillRect(0,0,width,logicalHeight);
    ctx.textBaseline='middle';
    function text(str,x,y,font,color,align='left'){
      ctx.fillStyle=color;ctx.font=font;ctx.textAlign=align;ctx.fillText(String(str),x,y);
    }
    text('TABLE LAY · CHRISTMAS',padX,57,'600 16px sans-serif','#917d67');
    text(`${round.title} 타임테이블`,padX,110,'bold 29px sans-serif','#252525');
    text(`시작 ${round.planned_start||'미정'}    종료 ${ending}    총 ${round.planned_duration}분`,padX,157,'18px sans-serif','#646464');
    const columns=[padX,148,270,380,754];
    ctx.fillStyle='#e9e4dc';ctx.fillRect(padX,196,width-padX*2,44);
    ['순서','서빙 시각','시작 후','코스 구성','수량 기준'].forEach((v,i)=>text(v,columns[i]+(i?0:8),219,'bold 15px sans-serif','#4b4540'));
    let y=240;
    const all=[...rows.map(r=>[pad(r.no),r.at,`+${r.minute}분`,r.name,r.unit]),['—',ending,`+${round.planned_duration}분`,'코스 종료','—']];
    all.forEach((data,i)=>{
      if(i%2===1){ctx.fillStyle='#f3f0eb';ctx.fillRect(padX,y,width-padX*2,rowHeight)}
      ctx.strokeStyle='#dedad4';ctx.beginPath();ctx.moveTo(padX,y+rowHeight);ctx.lineTo(width-padX,y+rowHeight);ctx.stroke();
      data.forEach((value,j)=>{
        const max=j===3?345:125;
        let display=String(value);
        ctx.font=(j===3?'bold ':'')+'17px sans-serif';
        while(display.length>1&&ctx.measureText(display).width>max)display=display.slice(0,-2)+'…';
        text(display,columns[j]+(j?0:8),y+rowHeight/2,(j===3?'bold ':'')+'17px sans-serif','#252525');
      });
      y+=rowHeight;
    });
    text('TABLE LAY  /  COURSE SERVICE TIMETABLE',padX,logicalHeight-33,'13px sans-serif','#948777');
    return canvas;
  }
  async function shareTimetableImage(){
    let blob;
    try{
      const canvas=drawTimetableImage(app.timetableRound);
      blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('PNG 생성 실패')),'image/png'));
    }catch(err){toast('이미지 생성 실패: '+err.message,true);return;}
    const filename=`Table_Lay_${app.timetableRound}_timetable.png`;
    if(typeof File!=='undefined'&&navigator.share&&navigator.canShare){
      const file=new File([blob],filename,{type:'image/png'});
      if(navigator.canShare({files:[file]})){
        try{await navigator.share({files:[file],title:'테이블레이 코스 타임테이블'});toast('타임테이블 이미지 공유를 완료했습니다.');return;}
        catch(err){if(err?.name==='AbortError')return;}
      }
    }
    downloadFile(blob,filename);
    toast('타임테이블 PNG 이미지를 저장했습니다.');
  }
  function printTimetable(){
    const sheet=$('print-sheet');sheet.replaceChildren();
    sheet.append($('timetable-sheet').cloneNode(true));
    window.print();
  }

  async function resetRound(){
    if(app.mode==='demo'){
      app.demos.set(app.activeRound,makeDemo(app.live));
      renderBoard();$('settings-dialog').close();toast('연습 데이터 초기화 완료');return;
    }
    if(!window.confirm(`${app.live.round.title}의 10개 테이블 고객 정보와 서빙 기록을 모두 지울까요? 백업하지 않았다면 복구할 수 없습니다.`))return;
    const result=await mutate(null,null,()=>{
      app.live.tables=Array.from({length:10},(_,i)=>({number:i+1,assigned:false,party_size:2,reservation_name:null,allergy_state:'unknown',allergy_note:'',started_at:null,seated:false,step:0,guests:makeGuests(2,app.live.round.meal),updated_at:Date.now()/1000}));
    });
    if(result){$('settings-dialog').close();toast('현재 회차가 초기화되었습니다.');}
  }
  async function downloadBackup(){
    if(app.mode==='demo'){toast('실제 운영 모드에서 백업하세요.',true);return;}
    if(app.busy||app.pendingTables.size){toast('저장 완료 후 백업하세요.',true);return;}
    const content={format:FORMAT_NAME,version:FORMAT_VERSION,exported_at:new Date().toISOString(),data:validateStore(serialize())};
    const blob=new Blob([JSON.stringify(content,null,2)],{type:'application/json;charset=utf-8'});
    const name=`Table_Lay_backup_${new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Seoul'})}_${new Date().toLocaleTimeString('en-GB',{timeZone:'Asia/Seoul',hour12:false}).replaceAll(':','')}.json`;
    // iPad installed PWAs can use the native Share Sheet to save to Files.
    // Other devices fall back to a regular JSON download.
    if(typeof File!=='undefined' && navigator.share && navigator.canShare){
      const file=new File([blob],name,{type:'application/json'});
      if(navigator.canShare({files:[file]})){
        try{
          await navigator.share({files:[file],title:'TABLE LAY 전체 데이터 백업'});
          toast('백업 파일 공유를 완료했습니다. 보관 위치를 확인하세요.');
          return;
        }catch(err){
          if(err?.name==='AbortError')return;
          // If the Share Sheet fails, provide the ordinary download fallback.
        }
      }
    }
    const url=URL.createObjectURL(blob);
    const anchor=document.createElement('a');anchor.href=url;anchor.download=name;
    document.body.append(anchor);anchor.click();anchor.remove();
    setTimeout(()=>URL.revokeObjectURL(url),10000);
    toast('7개 회차 JSON 백업을 저장했습니다. 파일 앱 등 별도 위치에 보관하세요.');
  }
  async function restoreBackup(event){
    const file=event.target.files&&event.target.files[0];
    event.target.value='';
    if(!file)return;
    if(app.mode==='demo'){toast('실제 운영 모드에서 복원하세요.',true);return;}
    if(app.syncActive){toast('연동 중 백업 복원은 금지됩니다. 두 기기 연동을 먼저 해제하세요.',true);return;}
    if(app.busy||app.pendingTables.size){toast('현재 저장 작업이 끝난 후 시도하세요.',true);return;}
    if(file.size>3*1024*1024){toast('백업 파일이 너무 큽니다.',true);return;}
    let validated;
    try{
      const backup=JSON.parse(await file.text());
      if(backup.format!==FORMAT_NAME||![1,2,FORMAT_VERSION].includes(backup.version)){
        throw new Error('이 앱의 버전 1·2·3 JSON 백업만 복원할 수 있습니다.');
      }
      validated=validateStore(backup.data);
    }catch(err){toast('복원 불가: '+err.message,true);return;}
    const confirmation=`백업 ${file.name}을 복원하면 이 태블릿의 7개 회차 데이터 전체가 덮어써집니다.\n\n현재 데이터를 먼저 백업했나요?`;
    if(!window.confirm(confirmation))return;
    app.busy=true;updateStatus();
    try{
      await dbWrite(validated);
      loadState(validated);
      app.demos.clear();app.mode='live';
      $('practice-bar').hidden=true;
      $('practice-toggle').textContent='연습 모드';
      $('practice-toggle').classList.remove('active');
      $('round-picker').value=app.activeRound;
      app.prevStatus=new Map();
      renderBoard();
      $('settings-dialog').close();
      toast('복원 완료: 7개 회차의 설정과 진행 상태를 복구했습니다.');
    }catch(err){toast('복원 실패: '+err.message,true);}
    finally{app.busy=false;updateStatus();drainBoardActions().catch(syncFailure);}
  }
  function bindEvents(){
    $('sync-open').addEventListener('click',()=>{if(app.mode==='demo'){toast('실제 운영 모드에서 연동을 설정하세요.',true);return;}$('sync-dialog').showModal();});
    $('sync-login').addEventListener('click',syncLogin);
    $('sync-seed').addEventListener('click',syncSeed);
    $('sync-join').addEventListener('click',syncJoin);
    $('sync-disconnect').addEventListener('click',syncDisconnect);
    window.addEventListener('online',()=>{if(app.syncActive){app.syncIssue='재연결 확인 중';updateStatus();window.TableLaySync.readCloud().then(applyRemote).catch(syncFailure);}else updateStatus();});
    window.addEventListener('offline',()=>{if(app.syncActive)app.syncIssue='인터넷 연결이 끊어졌습니다.';updateStatus();});
    $('storage-retry').addEventListener('click',()=>{ $('storage-retry').hidden=true;start(); });
    $('round-picker').addEventListener('change',async e=>{
      if(app.busy||app.pendingTables.size){e.target.value=app.activeRound;return;}
      app.activeRound=e.target.value;
      app.live=app.liveByRound.get(app.activeRound);
      if(app.mode==='demo'&&!app.demos.has(app.activeRound))app.demos.set(app.activeRound,makeDemo(app.live));
      app.lastMinute=null;app.prevStatus.clear();renderBoard();
      // Persist selected session as a convenience, without relying on any server.
      try{await dbWrite(serialize());}catch(err){toast('회차 선택 저장 실패: '+err.message,true);}
    });
    $('practice-toggle').addEventListener('click',()=>changeMode());
    $('demo-plus').addEventListener('click',()=>{const s=snapshot();s.demoTime+=300000;renderBoard();$('demo-time').textContent=prettyTime(s.demoTime);});
    $('demo-minus').addEventListener('click',()=>{const s=snapshot();s.demoTime-=300000;renderBoard();$('demo-time').textContent=prettyTime(s.demoTime);});
    $('demo-reset').addEventListener('click',()=>{app.demos.set(app.activeRound,makeDemo(app.liveByRound.get(app.activeRound)));renderBoard();$('demo-time').textContent=prettyTime(nowMs());toast('연습 회차를 초기화했습니다.');});
    $('settings-open').addEventListener('click',openSettings);
    $('timetable-open').addEventListener('click',()=>openTimetable());
    $('menu-tab').addEventListener('click',()=>setSettingsPane('menu'));
    $('time-tab').addEventListener('click',()=>setSettingsPane('time'));
    $('settings-meal-picker').addEventListener('change',e=>{app.configMeal=e.target.value;renderCourseEditor();});
    $('time-round-picker').addEventListener('change',e=>{app.timeRound=e.target.value;renderTimeEditor();});
    $('settings-start').addEventListener('change',refreshTimePreview);
    $('settings-duration').addEventListener('input',refreshTimePreview);
    $('save-menu').addEventListener('click',saveMenu);
    $('save-times').addEventListener('click',saveTimes);
    $('open-timetable-from-settings').addEventListener('click',()=>{
      $('settings-dialog').close();openTimetable(app.timeRound);
    });
    $('timetable-round-picker').addEventListener('change',e=>{app.timetableRound=e.target.value;renderTimetable();});
    $('timetable-copy').addEventListener('click',copyTimetable);
    $('timetable-image').addEventListener('click',shareTimetableImage);
    $('timetable-print').addEventListener('click',printTimetable);
    $('guide-button').addEventListener('click',()=>$('guide-dialog').showModal());
    document.querySelectorAll('[data-close]').forEach(btn=>btn.addEventListener('click',()=>$(btn.dataset.close).close()));
    $('party-minus').addEventListener('click',()=>adjustParty(-1));
    $('party-plus').addEventListener('click',()=>adjustParty(1));
    $('allergy-status').addEventListener('change',e=>{$('allergy-note').disabled=e.target.value!=='yes';});
    $('table-form').addEventListener('submit',saveTable);
    $('seat-all').addEventListener('click',seatAll);
    $('table-undo').addEventListener('click',undoCourse);
    $('table-clear').addEventListener('click',clearTable);
    $('course-add').addEventListener('click',()=>{
      const rows=[...$('course-editor').querySelectorAll('.course-row')];
      if(rows.length>=12){toast('최대 12개 코스까지 추가할 수 있습니다.',true);return;}
      addCourseRow({name:'새 코스',unit:'person'},rows.length);
    });
    $('settings-reset').addEventListener('click',resetRound);
    $('backup-button').addEventListener('click',downloadBackup);
    $('restore-button').addEventListener('click',()=>$('restore-file').click());
    $('restore-file').addEventListener('change',restoreBackup);
    ['table-dialog','settings-dialog','guide-dialog','timetable-dialog'].forEach(id=>{
      const dialog=$(id);
      dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close();});
    });
    window.addEventListener('online',updateStatus);
    window.addEventListener('offline',updateStatus);
  }
  fillRoundSelectors();
  bindEvents();
  start();
  setInterval(tick,1000);
  // Update experience: never delete IndexedDB or site storage. New service worker
  // activates after caching versioned assets and signals when a reload can apply it.
  let updateAvailable = false;
  let hadControllerAtStart = !!navigator.serviceWorker?.controller;
  let swRegistration = null;
  function showUpdateBanner(){
    updateAvailable = true;
    $('update-banner').hidden = false;
  }
  async function checkForUpdate(){
    if(!('serviceWorker' in navigator)){
      toast('이 브라우저는 오프라인 업데이트 기능을 지원하지 않습니다.',true);return;
    }
    if(!navigator.onLine){toast('온라인 상태에서 업데이트를 확인해 주세요.',true);return;}
    try{
      const reg = swRegistration || await navigator.serviceWorker.getRegistration('./');
      if(!reg){toast('오프라인 앱 설치가 아직 완료되지 않았습니다.',true);return;}
      await reg.update();
      if(reg.waiting && navigator.serviceWorker.controller){showUpdateBanner();return;}
      if(updateAvailable){showUpdateBanner();return;}
      if(reg.installing){toast('업데이트 파일 확인 중입니다. 잠시 후 다시 확인하세요.');return;}
      toast('현재 앱이 최신 상태입니다.');
    }catch(err){toast('업데이트 확인 실패: 인터넷 연결을 확인하세요.',true);}
  }
  $('update-check').addEventListener('click',checkForUpdate);
  $('update-apply').addEventListener('click',()=>{
    if(app.busy||app.pendingTables.size){toast('데이터 저장이 끝난 다음 업데이트하세요.',true);return;}
    const openDialog=['table-dialog','settings-dialog','timetable-dialog'].some(id=>$(id).open);
    if(openDialog && !window.confirm('편집 중인 내용이 있다면 먼저 저장하세요. 새 화면을 불러올까요?'))return;
    window.location.reload();
  });
  $('update-dismiss').addEventListener('click',()=>{$('update-banner').hidden=true;});
  if('serviceWorker' in navigator){
    navigator.serviceWorker.addEventListener('controllerchange',()=>{
      if(hadControllerAtStart)showUpdateBanner();
      hadControllerAtStart=true;
    });
    window.addEventListener('load',async()=>{
      try{
        swRegistration=await navigator.serviceWorker.register('./service-worker.js',{
          scope:'./', updateViaCache:'none'
        });
        swRegistration.addEventListener('updatefound',()=>{
          const installing=swRegistration.installing;
          if(!installing)return;
          installing.addEventListener('statechange',()=>{
            if(installing.state==='installed' && navigator.serviceWorker.controller)showUpdateBanner();
          });
        });
      }catch(err){
        console.warn('오프라인 캐시를 설치하지 못했습니다. HTTPS와 저장 공간을 확인하세요.');
      }
    });
  }
})();
