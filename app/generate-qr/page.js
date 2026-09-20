"use client";

import { useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

const DUPLICATE_MESSAGE =
  "โต๊ะนี้มีลูกค้าอยู่ระหว่างทานอาหาร กรุณาปิดออเดอร์เดิมก่อน";

// ช่องว่างถือเป็น 0, ค่าที่ไม่ใช่จำนวนเต็มไม่น้อยกว่า 0 คืน NaN
function toCount(value) {
  const text = value.trim();
  if (text === "") return 0;
  const n = Number(text);
  return Number.isInteger(n) && n >= 0 ? n : NaN;
}

export default function GenerateQrPage() {
  const [table, setTable] = useState("");
  const [adults, setAdults] = useState("");
  const [children, setChildren] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [session, setSession] = useState(null); // { table, adults, children, url }
  const [copied, setCopied] = useState(false);
  const [qrFailed, setQrFailed] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    if (loading) return;
    setError("");

    const tableNumber = Number(table.trim());
    const adultCount = toCount(adults);
    const childCount = toCount(children);

    if (table.trim() === "" || !Number.isInteger(tableNumber) || tableNumber < 1) {
      setError("กรุณากรอกเลขโต๊ะเป็นตัวเลขตั้งแต่ 1 ขึ้นไป");
      return;
    }
    if (Number.isNaN(adultCount) || Number.isNaN(childCount)) {
      setError("จำนวนผู้ใหญ่และเด็กต้องเป็นตัวเลข 0 ขึ้นไป");
      return;
    }
    if (adultCount + childCount < 1) {
      setError("กรุณากรอกจำนวนลูกค้าอย่างน้อย 1 คน");
      return;
    }

    setLoading(true);
    try {
      // 1) เช็คว่าโต๊ะนี้มี session ที่เปิดอยู่แล้วหรือไม่
      const { data: existing, error: checkError } = await supabase
        .from("sessions")
        .select("id")
        .eq("table_number", tableNumber)
        .eq("status", "open")
        .limit(1);

      if (checkError) throw checkError;

      if (existing && existing.length > 0) {
        setError(DUPLICATE_MESSAGE);
        return;
      }

      // 2) ยังไม่มี → เปิดโต๊ะใหม่
      const { error: insertError } = await supabase.from("sessions").insert({
        table_number: tableNumber,
        adult_count: adultCount,
        child_count: childCount,
        status: "open",
      });

      if (insertError) throw insertError;

      // 3) สำเร็จ → สร้างลิงก์จากโดเมนที่เปิดหน้านี้อยู่
      const url = `${window.location.origin}/order/${tableNumber}`;
      setQrFailed(false);
      setCopied(false);
      setSession({
        table: tableNumber,
        adults: adultCount,
        children: childCount,
        url,
      });
    } catch (err) {
      console.error(err);
      setError("เปิดโต๊ะไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    if (!session) return;
    try {
      await navigator.clipboard.writeText(session.url);
    } catch {
      // เบราว์เซอร์ที่ไม่รองรับ clipboard API (เช่นไม่ใช่ https)
      const textarea = document.createElement("textarea");
      textarea.value = session.url;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand("copy");
      } finally {
        document.body.removeChild(textarea);
      }
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleReset() {
    setTable("");
    setAdults("");
    setChildren("");
    setError("");
    setCopied(false);
    setQrFailed(false);
    setSession(null);
  }

  return (
    <main style={styles.page}>
      <div style={styles.container}>
        <Link href="/" style={styles.backLink}>
          ← หน้าแรก
        </Link>

        <h1 style={styles.title}>เปิดโต๊ะ</h1>

        {!session ? (
          <form onSubmit={handleSubmit} style={styles.form} noValidate>
            <label style={styles.field}>
              <span style={styles.label}>เลขโต๊ะ</span>
              <input
                type="number"
                inputMode="numeric"
                min="1"
                step="1"
                value={table}
                onChange={(e) => {
                  setTable(e.target.value);
                  setError("");
                }}
                style={styles.input}
                autoFocus
              />
            </label>

            <div style={styles.row}>
              <label style={styles.field}>
                <span style={styles.label}>ผู้ใหญ่</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  step="1"
                  placeholder="0"
                  value={adults}
                  onChange={(e) => setAdults(e.target.value)}
                  style={styles.input}
                />
              </label>

              <label style={styles.field}>
                <span style={styles.label}>เด็ก</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  step="1"
                  placeholder="0"
                  value={children}
                  onChange={(e) => setChildren(e.target.value)}
                  style={styles.input}
                />
              </label>
            </div>

            {error && (
              <p role="alert" style={styles.error}>
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{
                ...styles.primaryButton,
                opacity: loading ? 0.6 : 1,
                cursor: loading ? "wait" : "pointer",
              }}
            >
              {loading ? "กำลังเปิดโต๊ะ..." : "เปิดโต๊ะ"}
            </button>
          </form>
        ) : (
          <section style={styles.result} aria-live="polite">
            {qrFailed ? (
              <p role="alert" style={styles.error}>
                โหลดรูป QR ไม่สำเร็จ ให้ใช้ลิงก์ด้านล่างแทนได้
              </p>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(
                  session.url
                )}`}
                alt={`QR Code สำหรับโต๊ะ ${session.table}`}
                width={300}
                height={300}
                style={styles.qr}
                onError={() => setQrFailed(true)}
              />
            )}

            <p style={styles.summary}>
              โต๊ะ {session.table} · ผู้ใหญ่ {session.adults} · เด็ก{" "}
              {session.children}
            </p>

            <div style={styles.linkRow}>
              <span style={styles.url}>{session.url}</span>
              <button type="button" onClick={handleCopy} style={styles.copyButton}>
                {copied ? "คัดลอกแล้ว ✓" : "คัดลอกลิงก์"}
              </button>
            </div>

            <button
              type="button"
              onClick={handleReset}
              style={styles.primaryButton}
            >
              เปิดโต๊ะใหม่
            </button>
          </section>
        )}
      </div>
    </main>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    padding: "1.5rem 1rem 3rem",
  },
  container: {
    maxWidth: "560px",
    margin: "0 auto",
  },
  backLink: {
    display: "inline-block",
    padding: "0.5rem 0",
    fontSize: "1.1rem",
    color: "var(--broth)",
    textDecoration: "none",
  },
  title: {
    margin: "0.5rem 0 1.5rem",
    fontSize: "2.5rem",
    fontWeight: 800,
    color: "var(--broth)",
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: "1.25rem",
  },
  row: {
    display: "flex",
    gap: "1rem",
  },
  field: {
    display: "flex",
    flexDirection: "column",
    gap: "0.4rem",
    flex: 1,
  },
  label: {
    fontSize: "1.5rem",
    fontWeight: 600,
  },
  input: {
    width: "100%",
    minHeight: "72px",
    padding: "0.5rem 1rem",
    fontSize: "2rem",
    fontFamily: "inherit",
    color: "var(--ink)",
    background: "#fff",
    border: "2px solid var(--ink)",
    borderRadius: "12px",
  },
  error: {
    margin: 0,
    padding: "1rem 1.25rem",
    fontSize: "1.4rem",
    fontWeight: 600,
    color: "#b00020",
    background: "#fdecec",
    border: "2px solid #b00020",
    borderRadius: "12px",
  },
  primaryButton: {
    minHeight: "80px",
    width: "100%",
    fontSize: "2rem",
    fontWeight: 700,
    fontFamily: "inherit",
    color: "#fff",
    background: "var(--broth)",
    border: "none",
    borderRadius: "14px",
    cursor: "pointer",
  },
  result: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "1.25rem",
    textAlign: "center",
  },
  qr: {
    width: "300px",
    height: "300px",
    maxWidth: "100%",
    background: "#fff",
    padding: "12px",
    border: "2px solid var(--ink)",
    borderRadius: "12px",
  },
  summary: {
    margin: 0,
    fontSize: "2rem",
    fontWeight: 700,
  },
  linkRow: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    gap: "0.75rem",
    width: "100%",
  },
  url: {
    fontSize: "1.3rem",
    wordBreak: "break-all",
  },
  copyButton: {
    minHeight: "48px",
    padding: "0.4rem 1rem",
    fontSize: "1.1rem",
    fontWeight: 600,
    fontFamily: "inherit",
    color: "var(--broth)",
    background: "transparent",
    border: "2px solid var(--broth)",
    borderRadius: "10px",
    cursor: "pointer",
  },
};
