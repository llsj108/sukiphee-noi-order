# สุกี้ผีน้อย — ระบบสั่งอาหารร้านบุฟเฟต์

## Stack
- Next.js (App Router) + **JavaScript เท่านั้น (ห้ามใช้ TypeScript)**
- Deploy บน Vercel
- ฐานข้อมูล: Supabase (ใช้ผ่าน `lib/supabaseClient.js`)

## Environment variables
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## หน้าที่มีอยู่/วางแผนไว้
- `/` — หน้าแรก (ใช้ทดสอบ deploy)
- `/generate-qr` — สร้าง QR สำหรับโต๊ะ
- `/kitchen` — หน้าครัว

## โครงสร้างฐานข้อมูล (มีอยู่แล้วใน Supabase — ไม่ต้องสร้างใหม่)
ใช้ชื่อตารางและคอลัมน์ตามนี้เท่านั้น ห้ามเดาหรือเพิ่มคอลัมน์เอง

### sessions
| column | หมายเหตุ |
|---|---|
| id | |
| table_number | หมายเลขโต๊ะ |
| adult_count | จำนวนผู้ใหญ่ |
| child_count | จำนวนเด็ก |
| status | สถานะของ session |
| created_at | |

### menu_categories
| column | หมายเหตุ |
|---|---|
| id | |
| name | ชื่อหมวดเมนู |
| sort_order | ลำดับแสดงผล |

### menu_items
| column | หมายเหตุ |
|---|---|
| id | |
| category_id | อ้างอิง `menu_categories.id` |
| name | ชื่อเมนู |

### orders
| column | หมายเหตุ |
|---|---|
| id | |
| session_id | อ้างอิง `sessions.id` |
| table_number | |
| items | `jsonb` — รายการอาหารที่สั่ง |
| status | สถานะของออเดอร์ |
| created_at | |

## ข้อตกลงในการเขียนโค้ด
- Import Supabase client จาก `lib/supabaseClient.js` (`import { supabase } from "@/lib/supabaseClient"` หรือ path สัมพัทธ์)
- ไฟล์ที่ใช้ hook/event handler/realtime ต้องขึ้นต้นด้วย `"use client"`
- ข้อความบนหน้าจอเป็นภาษาไทย
