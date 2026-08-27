/****************************************************************
 * ตั้งค่ากลาง — แก้ไฟล์นี้ไฟล์เดียว ใช้ร่วมกันทุกหน้า
 ****************************************************************/

/**
 * URL ของ Web App ที่ deploy จาก Checkin-API
 * ได้มาจาก: Apps Script → Deploy → New deployment → Web app → Copy URL
 * (ต้องลงท้ายด้วย /exec เท่านั้น ไม่ใช่ /dev)
 */
var API_URL = 'https://script.google.com/macros/s/AKfycbziHLczAtNO4fKpL3Ea2Wf6M6Cro2a8R8eKiCZPcanpKFpRRzgUd0oEy8GOLbV_AEtQaQ/exec';

/** ชื่อองค์กร แสดงบนหัวแอพ */
var ORG_NAME = 'บริษัท ซี.ซี. คอนเทนท์ คอมเมอร์เชียล จำกัด';

/** ความแม่นยำ GPS ที่ถือว่า "ดีพอ" จะตัดสินใจได้ (เมตร) */
var GOOD_ACCURACY_M = 35;

/** ความแม่นยำแย่สุดที่ยังยอมให้กดเช็คอิน (ต้องไม่เกินค่าใน Code.gs) */
var MAX_ACCURACY_M = 150;

/** ขนาดรูปสูงสุดหลังย่อ (พิกเซล ด้านยาว) */
var PHOTO_MAX_PX = 1280;

/** คุณภาพ JPEG หลังย่อ (0-1) */
var PHOTO_QUALITY = 0.82;
