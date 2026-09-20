export const metadata = {
  title: 'สุกี้ผีน้อย',
  description: 'ระบบสั่งอาหารร้านบุฟเฟต์ สุกี้ผีน้อย',
};

export default function RootLayout({ children }) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
