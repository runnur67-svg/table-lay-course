const fs=require('fs');
const path=require('path');
const assert=require('assert');
const vm=require('vm');
const root=path.resolve(__dirname,'..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'static','manifest.webmanifest'),'utf8'));
const base='https://example.github.io/table-lay-course/';
const manifestUrl=base+'static/manifest.webmanifest';
assert.equal(new URL(manifest.start_url,manifestUrl).href,base);
assert.equal(new URL(manifest.scope,manifestUrl).href,base);
for(const icon of manifest.icons){
 const p=new URL(icon.src,manifestUrl).pathname.replace('/table-lay-course/','');
 assert(fs.existsSync(path.join(root,p)), 'Missing manifest icon: '+p);
}
for(const file of ['index.html','service-worker.js','static/app.js','static/style.css','static/manifest.webmanifest','static/icon.svg','static/icon-180.png','static/icon-192.png','static/icon-512.png']){
 assert(fs.existsSync(path.join(root,file)),'Missing offline file '+file);
}
const handlers={};
const assets=new Map();
const cache={
 addAll(paths){for(const u of paths){const relative=new URL(u).pathname.replace('/table-lay-course/','');assert(fs.existsSync(path.join(root,relative))||relative==='','Missing offline cache '+relative);assets.set(u,{asset:relative})}return Promise.resolve()},
 put(k,v){assets.set(typeof k==='string'?k:k.url,v);return Promise.resolve()}
};
const caches={
 open(){return Promise.resolve(cache)},keys(){return Promise.resolve(['tablelay-offline-old','tablelay-offline-v1-20261112'])},delete(){return Promise.resolve(true)},
 match(k){return Promise.resolve(assets.get(typeof k==='string'?k:k.url))}
};
const scope={
 self:{registration:{scope:base},location:{origin:'https://example.github.io'},addEventListener(t,fn){handlers[t]=fn},skipWaiting(){return Promise.resolve()},clients:{claim(){return Promise.resolve()}}},
 caches,URL,Promise,Response,
 fetch:()=>Promise.reject(new Error('offline'))
};
vm.runInNewContext(fs.readFileSync(path.join(root,'service-worker.js'),'utf8'),scope);
(async()=>{
 let job;handlers.install({waitUntil(p){job=p}});await job;
 assert(assets.has(base+'index.html'));
 let response;const request={method:'GET',mode:'navigate',url:base};
 handlers.fetch({request,respondWith(p){response=p},waitUntil(){}});
 const fallback=await response;
 assert.equal(fallback.asset,'index.html');
 console.log('PASS: GitHub Pages relative manifest and offline service-worker fallback');
})().catch(e=>{console.error(e);process.exit(1)});
