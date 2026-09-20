# บันทึกสำหรับการพัฒนาโปรเจกต์นี้ต่อ

## เวอร์ชัน Next.js
โปรเจกต์นี้ใช้ Next.js เวอร์ชันล่าสุด (App Router)

**สำคัญ:** ใน Dynamic Route (เช่น `app/order/[tableId]/page.js`) `params` (และ `searchParams`)
ที่ Next.js ส่งเข้ามาเป็น **Promise** ไม่ใช่ object ธรรมดาอีกต่อไป

### วิธีใช้งานที่ถูกต้อง

**Client Component** — ต้อง unwrap ด้วย `use()` จาก React เสมอ:

```jsx
'use client';
import { use } from 'react';

export default function OrderPage({ params }) {
  const { tableId } = use(params);
  // ...
}
```

**Server Component** — ต้อง `await` ก่อนใช้งาน:

```jsx
export default async function OrderPage({ params }) {
  const { tableId } = await params;
  // ...
}
```

ห้ามเข้าถึง `params.tableId` ตรง ๆ โดยไม่ unwrap เด็ดขาด เพราะจะ error หรือ warning

## ฐานข้อมูล Supabase (มีอยู่แล้ว — ห้ามสร้างตารางใหม่ทับ)

- `sessions (id, table_number, adult_count, child_count, status, created_at)`
- `menu_categories (id, name, sort_order)`
- `menu_items (id, category_id, name)`
- `orders (id, session_id, table_number, items jsonb, status, created_at)`

ใช้ client จาก `lib/supabaseClient.js` ในการเชื่อมต่อทุกครั้ง

## หน้าที่ยังไม่ได้สร้าง (ขั้นตอนถัดไป)

- `/generate-qr`
- `/kitchen`
- หน้าสั่งอาหารต่อโต๊ะ (Dynamic Route ที่ต้องใช้ `use(params)` ตามด้านบน)
