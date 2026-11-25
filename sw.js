'use strict';

// 오르내림 캘린더 오프라인 지원
// - 첫 화면(HTML): 네트워크 우선, 신호가 약하면 4초 뒤 저장본으로 열기
// - 앱 파일(js, css, 이미지): 저장본으로 바로 열고 뒤에서 새 버전 받기
// - Firebase SDK: 버전이 주소에 들어 있어 저장본 우선
// - 일정 데이터, 로그인, 날씨 요청은 건드리지 않음

const CACHE = 'oreunaerim-offline-v2';
const CORE = [
  './',
  './index.html',
  './oreunaerim-calendar.webmanifest?v=green',
  './oreunaerim-calendar-192.png?v=green',
  './icon-32.png?v=green',
  './forest-hiker-panda.webp',
  './crew-ribbon.jpeg',
  './crew-hike.jpeg'
];
const SDK_HOST = 'www.gstatic.com';

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(key => key.startsWith('oreunaerim-') && key !== CACHE).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});

async function remember(request, response) {
  if (!response || !response.ok || (response.type !== 'basic' && response.type !== 'cors')) return response;
  const cache = await caches.open(CACHE);
  const url = new URL(request.url);
  if (url.origin === self.location.origin && url.search) {
    // 같은 파일의 예전 버전(?v=...)은 지워서 저장 공간이 쌓이지 않게 함
    for (const old of await cache.keys()) {
      const oldUrl = new URL(old.url);
      if (oldUrl.pathname === url.pathname && oldUrl.search !== url.search) await cache.delete(old);
    }
  }
  await cache.put(request, response.clone());
  return response;
}

async function page(request) {
  const network = fetch(request).then(response => remember(new Request('./index.html'), response));
  const slow = new Promise(resolve => setTimeout(resolve, 4000));
  try {
    const response = await Promise.race([network, slow]);
    if (response) return response;
  } catch {}
  const saved = await caches.match('./index.html');
  if (saved) {
    network.catch(() => {});
    return saved;
  }
  return network;
}

async function asset(request, event) {
  const saved = await caches.match(request);
  const network = fetch(request).then(response => remember(request, response));
  if (saved) {
    event.waitUntil(network.catch(() => {}));
    return saved;
  }
  return network;
}

async function sdk(request) {
  return (await caches.match(request)) || fetch(request).then(response => remember(request, response));
}

self.addEventListener('fetch', event => {
  const {request} = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin) {
    if (request.mode === 'navigate') event.respondWith(page(request));
    else if (!url.pathname.endsWith('/sw.js')) event.respondWith(asset(request, event));
  } else if (url.hostname === SDK_HOST && url.pathname.startsWith('/firebasejs/')) {
    event.respondWith(sdk(request));
  }
});
