// Bump CACHE for every release; install the complete shell before activating.
const CACHE='sage-ledger-static-v2-20261115';
const ASSETS=['./','./index.html','./styles.css','./core.js','./app.js','./manifest.webmanifest','./icon.png','./icon-512.png','./icon.svg'];
self.addEventListener('message',e=>{if(e.data==='VERSION')e.ports[0]?.postMessage(CACHE);});
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('sage-ledger-static-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
 const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==self.location.origin)return;
 e.respondWith(caches.open(CACHE).then(async c=>(await c.match(e.request,{ignoreSearch:true}))||fetch(e.request)));
});
