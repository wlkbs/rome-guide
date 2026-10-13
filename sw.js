const SHELL='shell-v1-86', AUD='audio-v1';
const SHELL_FILES=['./','index.html','manifest.webmanifest','icon-180.png','icon-192.png','icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(SHELL).then(c=>c.addAll(SHELL_FILES)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k.startsWith('shell-')&&k!==SHELL).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
async function audio(req){
  const url=new URL(req.url); const key=url.pathname.slice(url.pathname.indexOf('/audio/')+1);
  const c=await caches.open(AUD); let res=await c.match(key);
  if(!res){ try{ res=await fetch(key); if(res.ok) await c.put(key,res.clone()); else return res; }catch(e){ return new Response('',{status:504}); } }
  const range=req.headers.get('range');
  if(!range) return res;
  const buf=await res.clone().arrayBuffer(); const size=buf.byteLength;
  const m=/bytes=(\d*)-(\d*)/.exec(range); let start=m&&m[1]?parseInt(m[1]):0; let end=m&&m[2]?parseInt(m[2]):size-1;
  if(!m[1]&&m[2]){ start=size-parseInt(m[2]); end=size-1; } end=Math.min(end,size-1);
  return new Response(buf.slice(start,end+1),{status:206,headers:{'Content-Type':'audio/mpeg','Content-Range':`bytes ${start}-${end}/${size}`,'Content-Length':String(end-start+1),'Accept-Ranges':'bytes'}});
}
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url); if(e.request.method!=='GET'||u.origin!==location.origin) return;
  if(u.pathname.includes('/audio/')){ e.respondWith(audio(e.request)); return; }
  e.respondWith(caches.match(e.request,{ignoreSearch:true}).then(r=>r||fetch(e.request).then(res=>{ if(res.ok){const cl=res.clone(); caches.open(SHELL).then(c=>c.put(e.request,cl));} return res; }).catch(()=>caches.match('index.html'))));
});
