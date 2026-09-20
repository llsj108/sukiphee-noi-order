import Link from 'next/link';

export default function HomePage() {
  return (
    <main style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
      <h1>สุกี้ผีน้อย</h1>
      <p>ระบบสั่งอาหารร้านบุฟเฟต์ (ทดสอบการ deploy)</p>
      <ul>
        <li>
          <Link href="/generate-qr">ไปหน้า Generate QR</Link>
        </li>
        <li>
          <Link href="/kitchen">ไปหน้า Kitchen</Link>
        </li>
      </ul>
    </main>
  );
}
