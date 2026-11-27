'use strict';

// 오르내림 캘린더 오프라인 지원
// - HTML 및 앱 파일: 요청 주소별 네트워크 우선, 연결 실패 시 동일 주소 저장본
// - Firebase SDK, Pretendard 글꼴: 버전이 주소에 들어 있어 저장본 우선
// - 일정 데이터, 로그인, 날씨 요청은 건드리지 않음

const CACHE = 'moily-dev-offline-v2';
const CORE = [
  './',
  './index.html',
  './oreunaerim-calendar.webmanifest?v=night',
  './oreunaerim-calendar-192.png?v=night',
  './icon-32.png?v=night',
  './forest-hiker-panda.webp',
  './crew-ribbon.jpeg',
  './crew-hike.jpeg'
];
const SDK_HOST = 'www.gstatic.com';
const FONT_PREFIX = 'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@';

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(key => key.startsWith('moily-dev-offline-') && key !== CACHE).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});

async function remember(request,response){
 if(response?.ok && !response.redirected && ['basic','cors'].includes(response.type)){
  try{await (await caches.open(CACHE)).put(request,response.clone());}catch{}
 }
 return response;
}
async function fresh(request){
 const cache=await caches.open(CACHE);
 try{return await remember(request,await fetch(request,{cache:'no-cache'}));}
 catch(error){const saved=await cache.match(request);if(saved)return saved;throw error;}
}
async function sdk(request){
 return (await (await caches.open(CACHE)).match(request)) || fetch(request).then(response=>remember(request,response));
}
self.addEventListener('fetch',event=>{
 const {request}=event;if(request.method!=='GET')return;
 const url=new URL(request.url);
 if(url.origin===self.location.origin && url.href.startsWith(self.registration.scope)){
  if(!url.pathname.endsWith('/sw.js'))event.respondWith(fresh(request));
 }else if((url.hostname===SDK_HOST&&url.pathname.startsWith('/firebasejs/'))||request.url.startsWith(FONT_PREFIX))event.respondWith(sdk(request));
});
