import Link from "next/link";

export default function HomePage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "2rem",
        padding: "2rem",
        textAlign: "center",
      }}
    >
      <h1
        style={{
          margin: 0,
          fontSize: "clamp(2.5rem, 10vw, 4.5rem)",
          fontWeight: 800,
          color: "var(--broth)",
          letterSpacing: "-0.01em",
        }}
      >
        สุกี้ผีน้อย
      </h1>

      <nav
        aria-label="เมนูหลัก"
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "1rem",
          justifyContent: "center",
        }}
      >
        <Link href="/generate-qr" style={linkStyle}>
          สร้าง QR โต๊ะ
        </Link>
        <Link href="/kitchen" style={linkStyle}>
          หน้าครัว
        </Link>
      </nav>
    </main>
  );
}

const linkStyle = {
  padding: "0.85rem 1.75rem",
  borderRadius: "999px",
  border: "2px solid var(--broth)",
  color: "var(--broth)",
  fontWeight: 600,
  textDecoration: "none",
};
