// 小源音乐 Service Worker — 离线缓存 + 类原生体验
var CACHE='xiaoyuan-v2';
var ASSETS=['/','/index.html','/manifest.json','/donate.png','https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css'];

self.addEventListener('install',function(e){
  e.waitUntil(caches.open(CACHE).then(function(c){return c.addAll(ASSETS)}))
});
self.addEventListener('activate',function(e){
  e.waitUntil(caches.keys().then(function(ks){return Promise.all(ks.filter(function(k){return k!==CACHE}).map(function(k){return caches.delete(k)}))}))
});
self.addEventListener('fetch',function(e){
  if(e.request.method!=='GET')return;
  e.respondWith(caches.match(e.request).then(function(r){
    return r||fetch(e.request).then(function(res){
      if(res.status===200){var r2=res.clone();caches.open(CACHE).then(function(c){c.put(e.request,r2)})}
      return res
    })
  }))
});
