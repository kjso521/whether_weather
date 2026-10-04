// 서비스 워커: 항상 네트워크에서 최신 파일을 먼저 받고, 받은 것을 저장해 둔다.
// 네트워크가 안 될 때만 저장해 둔 마지막 사본을 보여준다(오프라인에서도 마지막 예보가 열림).
const CACHE = "whether-weather";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      // ?v= 값이 달라도 같은 파일이면 저장된 사본을 쓴다
      .catch(() => caches.match(request, { ignoreSearch: true }).then((cached) => cached ?? Response.error()))
  );
});
