/****************************************************************
 * Service Worker — มีไว้เพื่อให้ติดตั้งเป็นแอพบนหน้าจอโฮมได้
 *
 * ใช้กลยุทธ์ "เครือข่ายก่อน" (network-first) เสมอ เพื่อไม่ให้พนักงาน
 * ติดอยู่กับโค้ดเวอร์ชันเก่าหลังจากอัปเดตแอพ — แคชเป็นแค่ตัวสำรอง
 * ตอนเน็ตหลุด ไม่ใช่แหล่งข้อมูลหลัก
 ****************************************************************/

var CACHE = 'checkin-v1';
var SHELL = ['./', './index.html', './style.css', './common.js', './config.js', './manifest.json'];

self.addEventListener('install', function (e) {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return c.addAll(SHELL).catch(function () { /* ไฟล์ใดโหลดไม่ได้ ก็ข้ามไป */ });
    })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === CACHE ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;

  // ข้ามทุกอย่างที่ไม่ใช่การเปิดหน้าเว็บของแอพเอง
  // (โดยเฉพาะการเรียก API — ต้องไม่ถูกแคชเด็ดขาด)
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== location.origin) return;

  e.respondWith(
    fetch(req)
      .then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
        return res;
      })
      .catch(function () {
        return caches.match(req).then(function (hit) {
          return hit || caches.match('./index.html');
        });
      })
  );
});
