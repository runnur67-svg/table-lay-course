const assert=require('assert');
const fs=require('fs');const vm=require('vm');
const html=fs.readFileSync(require('path').join(__dirname,'..','index.html'),'utf8');
const v5=process.argv.includes('--v5');
let downloadedBackup;
const source=fs.readFileSync(require('path').join(__dirname,'..','static',v5?'app-v5.js':'app.js'),'utf8');
const ids=[...html.matchAll(/\bid="([\w-]+)"/g)].map(x=>x[1]);
class MockElement {
  constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this._text='';this.className='';this.dataset={};this.style={};this.events={};this.value='';this.checked=false;this.disabled=false;this.hidden=false;this.open=false;this.attributes={};}
  get textContent(){return this._text+this.children.map(c=>c.textContent??'').join('')}
  set textContent(v){this._text=String(v??'');this.children=[]}
  get classList(){const that=this;return {contains(x){return that.className.split(' ').includes(x)},add(...xs){for(const x of xs)if(!this.contains(x))that.className+=' '+x},remove(...xs){that.className=that.className.split(' ').filter(x=>!xs.includes(x)).join(' ')},toggle(x,on){if(on===undefined)on=!this.contains(x);on?this.add(x):this.remove(x)}}}
  get childElementCount(){return this.children.length}
  append(...els){for(const el of els)this.children.push(typeof el==='string'?{textContent:el}:el)}
  replaceChildren(...els){this.children=[];this._text='';this.append(...els)}
  addEventListener(evt,fn){(this.events[evt]??=[]).push(fn)}
  async fire(evt,props={}){for(const fn of this.events[evt]||[])await fn({target:this,preventDefault(){},...props});}
  click(){return this.fire('click')}
  setAttribute(k,v){this.attributes[k]=String(v)}
  getAttribute(k){return this.attributes[k]}
  showModal(){this.open=true;this.hidden=false}
  close(){this.open=false}
  remove(){this._removed=true}
  focus(){}
  matches(sel){if(sel.startsWith('.'))return this.classList.contains(sel.slice(1));return false}
  querySelectorAll(sel){const found=[];function visit(el){for(const ch of el.children){if(ch.matches?.(sel))found.push(ch);visit(ch)}}visit(this);return found}
  querySelector(sel){return this.querySelectorAll(sel)[0]||null}
}
const elements=Object.fromEntries(ids.map(id=>[id,new MockElement()]));
for(const name of ['app','practice-bar','settings-dialog','table-dialog','guide-dialog'])elements[name].hidden=['app','practice-bar'].includes(name);
const doc={
 getElementById:id=>elements[id]||null,
 createElement:tag=>new MockElement(tag),
 querySelectorAll:(sel)=>sel==='[data-close]'?[]:[],
 querySelector:sel=>{
   if(sel.startsWith('.table-card')){
     let cards=[...elements['table-row-top'].children,...elements['table-row-bottom'].children];
     let number=sel.match(/data-table="(\d+)"/);
     return cards.find(c=>c.classList.contains('table-card')&&c.dataset.table==number?.[1]);
   }
   return null;
 },
 body:new MockElement('body')
};
const globalStore={value:null,created:false};
function mockIDB() {
  return {
    open() {
      const request = {};
      setTimeout(() => {
        const db = {
          objectStoreNames: { contains: () => globalStore.created },
          createObjectStore() { globalStore.created = true; },
          transaction() {
            const tx = {
              error: null,
              objectStore() {
                return {
                  get() {
                    const r = {};
                    setTimeout(() => {
                      r.result = globalStore.value ? structuredClone(globalStore.value) : null;
                      r.onsuccess?.();
                    }, 0);
                    return r;
                  },
                  put(value) {
                    const copy = structuredClone(value);
                    setTimeout(() => { globalStore.value = copy; tx.oncomplete?.(); }, 0);
                    return {};
                  }
                };
              }
            };
            return tx;
          }
        };
        request.result = db;
        if (!globalStore.created) request.onupgradeneeded?.();
        request.onsuccess?.();
      }, 0);
      return request;
    }
  };
}
function launch(){const window={confirm:()=>true,addEventListener(){},location:{href:'http://localhost:8765/'}};
  const fakeIDB=mockIDB();window.indexedDB=fakeIDB;const ctx=vm.createContext({window,document:doc,navigator:{onLine:true,storage:{persist:async()=>true}},indexedDB:fakeIDB,Intl,Date,JSON,Object,Map,Set,String,Number,Array,RegExp,Error,Promise,Math,console,setTimeout,clearTimeout,setInterval:()=>0,Blob,URL:{createObjectURL:blob=>{downloadedBackup=blob;return 'blob:abc'},revokeObjectURL:()=>{}}});
  vm.runInContext(source,ctx);return ctx;}
async function sleep(t=20){await new Promise(r=>setTimeout(r,t))}
async function main(){launch();await sleep(80);
  assert.equal(elements['auth-screen'].hidden,true,'app should open without PIN');
  assert.equal(elements['app'].hidden,false,'app visible');
  assert.equal(elements['table-row-top'].children.length,5);
  assert.equal(elements['table-row-bottom'].children.length,5);
  assert.equal(Object.keys(globalStore.value.rounds).length,7);
  console.log('PASS: IndexedDB boot, 10 cards, 7 rounds');
  let t1=elements['table-row-bottom'].children[4];
  await t1.children[0].click();
  await elements['party-plus'].click();
  elements['allergy-status'].value='yes';await elements['allergy-status'].fire('change');
  elements['allergy-note'].value='갑각류';
  await elements['table-form'].fire('submit');await sleep(20);
  assert.equal(globalStore.value.rounds['24-l1'].tables[0].party_size,3);
  assert.equal(globalStore.value.rounds['24-l1'].tables[0].allergy_note,'갑각류');
  assert.equal(elements['quantity-grand'].textContent,'21개');
  console.log('PASS: table registered, allergy & 3-person quantity counted');
  t1=elements['table-row-bottom'].children[4];
  await t1.children[1].children[0].click();await sleep(30);
  assert.equal(globalStore.value.rounds['24-l1'].tables[0].step,1);
  assert.equal(elements['quantity-grand'].textContent,'18개');
  console.log('PASS: course completion auto-save and subtracts quantity');
  elements['round-picker'].value='24-d1';await elements['round-picker'].fire('change');await sleep(30);
  assert.equal(elements['quantity-grand'].textContent,'0개');
  assert.equal(globalStore.value.rounds['24-l1'].tables[0].step,1);
  console.log('PASS: independent round data');
  elements['round-picker'].value='24-l1';await elements['round-picker'].fire('change');await sleep(30);
  await elements['settings-open'].click();
  assert.equal(elements['course-editor'].querySelectorAll('.course-row').length,7);
  // Shared menu composition: a change in lunch applies to ALL three lunch sessions.
  elements['settings-meal-picker'].value='lunch';
  await elements['settings-meal-picker'].fire('change');
  const menuRows=elements['course-editor'].querySelectorAll('.course-row');
  menuRows[4].querySelector('.course-name').value='트러플 스테이크';
  await elements['save-menu'].click();await sleep(30);
  for(const id of ['24-l1','25-l1','25-l2'])
    assert.equal(globalStore.value.rounds[id].round.courses[4].name,'트러플 스테이크');
  assert.equal(globalStore.value.rounds['24-d1'].round.courses[6].name,'메인 스테이크');
  console.log('PASS: shared lunch course names, dinner unaffected');
  // Different start times and course offsets for 24 and 25 lunch.
  await elements['time-tab'].click();
  elements['time-round-picker'].value='24-l1';await elements['time-round-picker'].fire('change');
  elements['settings-start'].value='12:00';
  elements['settings-duration'].value='95';
  elements['time-course-editor'].querySelectorAll('.time-minute')[4].value='47';
  await elements['save-times'].click();await sleep(30);
  elements['time-round-picker'].value='25-l1';await elements['time-round-picker'].fire('change');
  elements['settings-start'].value='11:45';
  elements['settings-duration'].value='100';
  elements['time-course-editor'].querySelectorAll('.time-minute')[4].value='52';
  await elements['save-times'].click();await sleep(30);
  assert.equal(globalStore.value.rounds['24-l1'].round.planned_start,'12:00');
  assert.equal(globalStore.value.rounds['25-l1'].round.planned_start,'11:45');
  assert.equal(globalStore.value.rounds['24-l1'].round.courses[4].minute,47);
  assert.equal(globalStore.value.rounds['25-l1'].round.courses[4].minute,52);
  assert.equal(globalStore.value.rounds['25-l2'].round.courses[4].minute,44);
  assert.equal(globalStore.value.rounds['25-l1'].round.planned_duration,100);
  console.log('PASS: independent round times and end times');
  await elements['timetable-open'].click();
  assert(elements['timetable-sheet'].textContent.includes('트러플 스테이크'));
  assert(elements['timetable-sheet'].textContent.includes('12:47'));
  elements['timetable-round-picker'].value='25-l1';
  await elements['timetable-round-picker'].fire('change');
  assert(elements['timetable-sheet'].textContent.includes('12:37'));
  console.log('PASS: per-round timetable views');
  const payload={format:'tablelay-course-control',version:2,exported_at:new Date().toISOString(),data:structuredClone(globalStore.value)};
  await elements['table-row-bottom'].children[4].children[1].children[0].click();await sleep(30);
  assert.equal(globalStore.value.rounds['24-l1'].tables[0].step,2);
  await elements['restore-file'].fire('change',{target:{files:[{name:'backup.json',size:JSON.stringify(payload).length,text:async()=>JSON.stringify(payload)}],value:''}});await sleep(30);
  assert.equal(globalStore.value.rounds['24-l1'].tables[0].step,1);
  console.log('PASS: JSON restore rollback to earlier saved point');
  // Backward-compatible v1 import: prior archives had no planned_duration.
  const legacy=structuredClone(globalStore.value);
  for(const value of Object.values(legacy.rounds))delete value.round.planned_duration;
  const v1={format:'tablelay-course-control',version:1,data:legacy};
  await elements['restore-file'].fire('change',{target:{files:[{name:'legacy-v1.json',size:JSON.stringify(v1).length,text:async()=>JSON.stringify(v1)}],value:''}});await sleep(40);
  assert.equal(globalStore.value.rounds['24-l1'].round.planned_duration,90);
  assert.equal(globalStore.value.rounds['25-l1'].round.planned_duration,90);
  assert.equal(globalStore.value.rounds['24-l1'].round.courses[4].name,'트러플 스테이크');
  console.log('PASS: legacy v1 backup import and automatic duration migration');
  // Reload the same JS VM through a fresh fake DOM test would require separate elements; direct DB state demonstrates actual persisted record.
  console.log('ALL MOCK UI TESTS PASSED');
}
async function testV5(){
  launch();await sleep(80);
  const round=()=>globalStore.value.rounds['24-l1'];
  const table=()=>round().tables[0];
  const card=()=>elements['table-row-bottom'].children[4];
  const open=()=>card().querySelector('.card-main').click();
  const save=()=>elements['table-form'].fire('submit');
  const action=()=>card().querySelector('.serve-action').click();
  const displayedName=()=>card().querySelector('.table-reservation-name')?.textContent;
  const restore=payload=>elements['restore-file'].fire('change',{target:{files:[{
    name:'backup.json',size:payload.length,text:async()=>payload
  }],value:''}});
  assert.equal(elements.app.hidden,false);
  assert.equal(elements['table-row-top'].children.length,5);
  assert.equal(elements['table-row-bottom'].children.length,5);
  assert.equal(Object.keys(globalStore.value.rounds).length,7);

  // Simulate an existing v5 IndexedDB record with no reservation name field.
  delete table().reservation_name;
  launch();await sleep(40);
  await open();
  assert.equal(elements['reservation-name'].value,'');
  elements['reservation-name'].value='  김테이블  ';
  elements['allergy-status'].value='yes';
  elements['allergy-note'].value='갑각류';
  await save();
  assert.equal(displayedName(),'김테이블');
  assert.equal(card().querySelector('.table-party').className,'table-party');
  assert.equal(card().querySelector('.serve-action').textContent,'착석 완료');
  assert.equal(table().allergy_note,'갑각류');

  await open();
  assert.equal(elements['reservation-name'].value,'김테이블');
  elements['reservation-name'].value='이테이블';
  await elements['party-plus'].click();
  await save();
  assert.equal(displayedName(),'이테이블');
  assert(card().querySelector('.table-party').classList.contains('table-party-three'));

  await action();
  assert.equal(table().seated,true);
  assert.equal(table().started_at,null);
  assert.equal(displayedName(),'이테이블');
  await action();
  assert(table().started_at>0);
  assert.equal(elements['quantity-grand'].textContent,'3개');
  await action();
  assert.equal(table().step,1);
  assert.equal(displayedName(),'이테이블');

  launch();await sleep(40);
  assert.equal(displayedName(),'이테이블');
  await elements['settings-open'].click();
  await elements['backup-button'].click();
  const payload=await downloadedBackup.text();
  assert.equal(JSON.parse(payload).data.rounds['24-l1'].tables[0].reservation_name,'이테이블');

  await open();
  elements['reservation-name'].value='';
  await save();
  assert.equal(displayedName(),'이테이블');
  await open();
  await elements['table-clear'].click();
  assert.equal(table().reservation_name,null);
  assert.equal(displayedName(),undefined);
  await restore(payload);
  assert.equal(displayedName(),'이테이블');
  assert.equal(table().step,1);
  assert.equal(table().allergy_note,'갑각류');

  const legacy=JSON.parse(payload);
  delete legacy.data.rounds['24-l1'].tables[0].reservation_name;
  await restore(JSON.stringify(legacy));
  assert.equal(displayedName(),undefined);
  assert.equal(table().party_size,3);
  assert.equal(table().allergy_note,'갑각류');
  assert.equal(table().step,1);
  console.log('PASS: v5 reservation names, badge, seating, course, IndexedDB, and JSON compatibility');
}
(v5?testV5():main()).catch(e=>{console.error('FAIL',e);process.exit(1)});
