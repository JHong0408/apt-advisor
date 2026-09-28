// PWA 설치 조건 충족 + 정적 자산(CSS/아이콘)만 캐싱하는 최소 서비스 워커.
// HTML/API는 절대 캐싱하지 않는다 - 공고 데이터/로그인 상태가 오래된 채로 보이면 안 되므로
// (home-main의 sw.js와 동일한 원칙).
const CACHE_NAME = "apt-advisor-static-v1";
const STATIC_ASSETS = ["/assets/site.css", "/assets/icon.svg"];

self.addEventListener("install", (event) => {
	event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)));
	self.skipWaiting();
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))),
	);
	self.clients.claim();
});

self.addEventListener("fetch", (event) => {
	const url = new URL(event.request.url);
	if (event.request.method !== "GET" || !STATIC_ASSETS.includes(url.pathname)) return;

	event.respondWith(
		caches.match(event.request).then((cached) => {
			const network = fetch(event.request)
				.then((res) => {
					caches.open(CACHE_NAME).then((cache) => cache.put(event.request, res.clone()));
					return res;
				})
				.catch(() => cached);
			return cached || network;
		}),
	);
});
