"use client";

import { use, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

const ADULT_PRICE = 289;
const CHILD_PRICE = 145;
const MAX_CART_LINES = 10;
const MAX_QTY = 5;

export default function OrderPage({ params }) {
  // Next.js 15+: params เป็น Promise เสมอ ต้อง unwrap ด้วย use() ก่อนใช้งาน
  // (จุดนี้คือสาเหตุที่พบบ่อยที่สุดที่ทำให้หน้านี้หาโต๊ะไม่เจอทั้งที่เปิดโต๊ะไว้แล้ว)
  const { tableNumber: tableNumberParam } = use(params);
  const tableNumber = Number(tableNumberParam);

  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null); // { id, adult_count, child_count }
  const [notOpen, setNotOpen] = useState(false);
  const [categories, setCategories] = useState([]);
  const [items, setItems] = useState([]);
  const [activeCat, setActiveCat] = useState(null);
  const [cart, setCart] = useState([]); // [{ id, name, quantity }]
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [sentFlash, setSentFlash] = useState(false);
  const [showBillConfirm, setShowBillConfirm] = useState(false);
  const [billing, setBilling] = useState(false);
  const [closed, setClosed] = useState(false);

  // 1) เช็คว่าโต๊ะนี้มี session เปิดอยู่ไหม
  useEffect(() => {
    let ignore = false;

    async function loadSession() {
      if (!Number.isInteger(tableNumber) || tableNumber < 1) {
        setNotOpen(true);
        setLoading(false);
        return;
      }
      const { data, error } = await supabase
        .from("sessions")
        .select("id, adult_count, child_count, status")
        .eq("table_number", tableNumber)
        .eq("status", "open")
        .order("created_at", { ascending: false })
        .limit(1);

      if (ignore) return;
      if (error || !data || data.length === 0) {
        setNotOpen(true);
      } else {
        setSession(data[0]);
        setNotOpen(false);
      }
      setLoading(false);
    }

    loadSession();
    return () => {
      ignore = true;
    };
  }, [tableNumber]);

  // 2) โหลดเมนู (ไม่ต้องรอ session)
  useEffect(() => {
    async function loadMenu() {
      const [{ data: cats }, { data: menuItems }] = await Promise.all([
        supabase
          .from("menu_categories")
          .select("id, name, sort_order")
          .order("sort_order", { ascending: true }),
        supabase
          .from("menu_items")
          .select("id, category_id, name")
          .order("id", { ascending: true }),
      ]);
      setCategories(cats ?? []);
      setItems(menuItems ?? []);
      if (cats && cats.length > 0) setActiveCat(cats[0].id);
    }
    loadMenu();
  }, []);

  const itemsByCat = useMemo(() => {
    const map = {};
    for (const it of items) {
      (map[it.category_id] ??= []).push(it);
    }
    return map;
  }, [items]);

  function addToCart(item) {
    setCart((prev) => {
      const idx = prev.findIndex((l) => l.id === item.id);
      if (idx >= 0) {
        const line = prev[idx];
        if (line.quantity >= MAX_QTY) return prev;
        const next = [...prev];
        next[idx] = { ...line, quantity: line.quantity + 1 };
        return next;
      }
      if (prev.length >= MAX_CART_LINES) return prev;
      return [...prev, { id: item.id, name: item.name, quantity: 1 }];
    });
  }

  function decFromCart(itemId) {
    setCart((prev) =>
      prev
        .map((l) => (l.id === itemId ? { ...l, quantity: l.quantity - 1 } : l))
        .filter((l) => l.quantity > 0)
    );
  }

  const cartCount = cart.reduce((sum, l) => sum + l.quantity, 0);

  async function handleSendOrder() {
    if (cart.length === 0 || sending || !session) return;
    setSending(true);
    setSendError("");
    try {
      const { error } = await supabase.from("orders").insert({
        session_id: session.id,
        table_number: tableNumber,
        items: cart.map((l) => ({ name: l.name, quantity: l.quantity })),
        status: "received",
      });
      if (error) throw error;
      setCart([]);
      setSentFlash(true);
      setTimeout(() => setSentFlash(false), 2500);
    } catch (err) {
      console.error(err);
      setSendError("ส่งออเดอร์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setSending(false);
    }
  }

  const billTotal = session
    ? session.adult_count * ADULT_PRICE + session.child_count * CHILD_PRICE
    : 0;

  async function handleConfirmBill() {
    if (!session || billing) return;
    setBilling(true);
    try {
      const { data, error } = await supabase
        .from("sessions")
        .update({ status: "closed" })
        .eq("id", session.id)
        .eq("status", "open")
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("ไม่มีแถวถูกอัปเดต");
      setShowBillConfirm(false);
      setClosed(true);
    } catch (err) {
      console.error(err);
      setSendError("เรียกเก็บเงินไม่สำเร็จ กรุณาแจ้งพนักงาน");
      setShowBillConfirm(false);
    } finally {
      setBilling(false);
    }
  }

  // ---------- render states ----------
  if (loading) {
    return (
      <main style={styles.centerPage}>
        <p style={styles.centerText}>กำลังโหลด...</p>
      </main>
    );
  }

  if (notOpen) {
    return (
      <main style={styles.centerPage}>
        <h1 style={styles.centerTitle}>โต๊ะนี้ยังไม่เปิดใช้งาน</h1>
        <p style={styles.centerText}>กรุณาแจ้งพนักงานหน้าร้าน</p>
      </main>
    );
  }

  if (closed) {
    return (
      <main style={styles.centerPage}>
        <h1 style={styles.centerTitle}>ขอบคุณที่ใช้บริการ</h1>
        <p style={styles.centerText}>โต๊ะ {tableNumber} ปิดรายการแล้ว</p>
      </main>
    );
  }

  const activeItems = itemsByCat[activeCat] ?? [];

  return (
    <main style={styles.page}>
      <header style={styles.header}>
        <div>
          <div style={styles.shop}>สุกี้ผีน้อย</div>
          <h1 style={styles.title}>โต๊ะ {tableNumber}</h1>
        </div>
        <button
          type="button"
          style={styles.billButton}
          onClick={() => setShowBillConfirm(true)}
        >
          เรียกเก็บเงิน
        </button>
      </header>

      <nav style={styles.tabs} aria-label="หมวดหมู่เมนู">
        {categories.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setActiveCat(c.id)}
            style={{
              ...styles.tab,
              ...(c.id === activeCat ? styles.tabActive : null),
            }}
          >
            {c.name}
          </button>
        ))}
      </nav>

      {sendError && (
        <p role="alert" style={styles.error}>
          {sendError}
        </p>
      )}
      {sentFlash && (
        <p role="status" style={styles.success}>
          ส่งออเดอร์แล้ว ✓
        </p>
      )}

      <ul style={styles.menuList}>
        {activeItems.map((it) => {
          const line = cart.find((l) => l.id === it.id);
          return (
            <li key={it.id} style={styles.menuRow}>
              <span style={styles.menuName}>{it.name}</span>
              <div style={styles.qtyControl}>
                {line ? (
                  <>
                    <button
                      type="button"
                      style={styles.qtyBtn}
                      onClick={() => decFromCart(it.id)}
                    >
                      −
                    </button>
                    <span style={styles.qtyNum}>{line.quantity}</span>
                    <button
                      type="button"
                      style={{
                        ...styles.qtyBtn,
                        opacity: line.quantity >= MAX_QTY ? 0.35 : 1,
                      }}
                      onClick={() => addToCart(it)}
                      disabled={line.quantity >= MAX_QTY}
                    >
                      +
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    style={styles.addBtn}
                    onClick={() => addToCart(it)}
                    disabled={cart.length >= MAX_CART_LINES}
                  >
                    + เพิ่ม
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {cartCount > 0 && (
        <div style={styles.cartBar}>
          <span style={styles.cartText}>ตะกร้า {cartCount} รายการ</span>
          <button
            type="button"
            style={{ ...styles.sendButton, opacity: sending ? 0.6 : 1 }}
            onClick={handleSendOrder}
            disabled={sending}
          >
            {sending ? "กำลังส่ง..." : "ส่งออเดอร์"}
          </button>
        </div>
      )}

      {showBillConfirm && (
        <div style={styles.overlay}>
          <div style={styles.dialog}>
            <h2 style={styles.dialogTitle}>ยืนยันเรียกเก็บเงิน?</h2>
            <p style={styles.dialogBody}>
              ผู้ใหญ่ {session.adult_count} × {ADULT_PRICE} + เด็ก{" "}
              {session.child_count} × {CHILD_PRICE}
            </p>
            <p style={styles.dialogTotal}>
              รวม {billTotal.toLocaleString("th-TH")} บาท
            </p>
            <div style={styles.dialogActions}>
              <button
                type="button"
                style={styles.dialogCancel}
                onClick={() => setShowBillConfirm(false)}
              >
                ยกเลิก
              </button>
              <button
                type="button"
                style={{ ...styles.dialogConfirm, opacity: billing ? 0.6 : 1 }}
                onClick={handleConfirmBill}
                disabled={billing}
              >
                {billing ? "กำลังปิดโต๊ะ..." : "ยืนยัน"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

const styles = {
  centerPage: {
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "1rem",
    padding: "2rem",
    textAlign: "center",
  },
  centerTitle: {
    margin: 0,
    fontSize: "2rem",
    fontWeight: 800,
    color: "var(--broth)",
  },
  centerText: {
    margin: 0,
    fontSize: "1.4rem",
  },
  page: {
    minHeight: "100vh",
    paddingBottom: "6rem",
  },
  header: {
    position: "sticky",
    top: 0,
    zIndex: 10,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "1rem",
    padding: "1rem 1.25rem",
    background: "var(--steam)",
    borderBottom: "3px solid var(--broth)",
  },
  shop: {
    fontSize: "1rem",
    opacity: 0.75,
  },
  title: {
    margin: 0,
    fontSize: "1.9rem",
    fontWeight: 800,
    color: "var(--broth)",
  },
  billButton: {
    minHeight: "56px",
    padding: "0 1.25rem",
    fontSize: "1.15rem",
    fontWeight: 700,
    fontFamily: "inherit",
    color: "var(--broth)",
    background: "#fff",
    border: "2px solid var(--broth)",
    borderRadius: "12px",
    cursor: "pointer",
  },
  tabs: {
    display: "flex",
    gap: "0.5rem",
    overflowX: "auto",
    padding: "1rem 1.25rem 0.5rem",
  },
  tab: {
    flexShrink: 0,
    minHeight: "52px",
    padding: "0 1.25rem",
    fontSize: "1.15rem",
    fontWeight: 700,
    fontFamily: "inherit",
    color: "var(--ink)",
    background: "#fff",
    border: "2px solid var(--ink)",
    borderRadius: "999px",
    cursor: "pointer",
  },
  tabActive: {
    color: "#fff",
    background: "var(--broth)",
    borderColor: "var(--broth)",
  },
  error: {
    margin: "0 1.25rem",
    padding: "0.85rem 1.1rem",
    fontSize: "1.15rem",
    fontWeight: 600,
    color: "#b00020",
    background: "#fdecec",
    border: "2px solid #b00020",
    borderRadius: "12px",
  },
  success: {
    margin: "0 1.25rem",
    padding: "0.7rem 1.1rem",
    fontSize: "1.15rem",
    fontWeight: 700,
    color: "#1f7a3d",
    background: "#e8f6ec",
    border: "2px solid #1f7a3d",
    borderRadius: "12px",
  },
  menuList: {
    listStyle: "none",
    margin: 0,
    padding: "0.5rem 1.25rem 1rem",
    display: "flex",
    flexDirection: "column",
    gap: "0.75rem",
  },
  menuRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "1rem",
    padding: "1rem 1.1rem",
    background: "#fff",
    border: "2px solid var(--ink)",
    borderRadius: "14px",
  },
  menuName: {
    fontSize: "1.4rem",
    fontWeight: 700,
  },
  qtyControl: {
    display: "flex",
    alignItems: "center",
    gap: "0.6rem",
    flexShrink: 0,
  },
  addBtn: {
    minHeight: "52px",
    padding: "0 1.1rem",
    fontSize: "1.1rem",
    fontWeight: 700,
    fontFamily: "inherit",
    color: "#fff",
    background: "var(--broth)",
    border: "none",
    borderRadius: "10px",
    cursor: "pointer",
  },
  qtyBtn: {
    width: "48px",
    height: "48px",
    fontSize: "1.6rem",
    fontWeight: 800,
    fontFamily: "inherit",
    color: "#fff",
    background: "var(--broth)",
    border: "none",
    borderRadius: "10px",
    cursor: "pointer",
  },
  qtyNum: {
    minWidth: "1.6rem",
    textAlign: "center",
    fontSize: "1.4rem",
    fontWeight: 800,
  },
  cartBar: {
    position: "fixed",
    left: 0,
    right: 0,
    bottom: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "1rem",
    padding: "1rem 1.25rem",
    background: "var(--ink)",
    color: "#fff",
  },
  cartText: {
    fontSize: "1.25rem",
    fontWeight: 700,
  },
  sendButton: {
    minHeight: "60px",
    padding: "0 1.75rem",
    fontSize: "1.3rem",
    fontWeight: 800,
    fontFamily: "inherit",
    color: "var(--ink)",
    background: "var(--ladle)",
    border: "none",
    borderRadius: "12px",
    cursor: "pointer",
  },
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(42, 26, 23, 0.55)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "1.5rem",
    zIndex: 20,
  },
  dialog: {
    width: "100%",
    maxWidth: "420px",
    padding: "1.75rem",
    background: "#fff",
    borderRadius: "18px",
    textAlign: "center",
  },
  dialogTitle: {
    margin: "0 0 1rem",
    fontSize: "1.6rem",
    fontWeight: 800,
    color: "var(--broth)",
  },
  dialogBody: {
    margin: "0 0 0.5rem",
    fontSize: "1.1rem",
  },
  dialogTotal: {
    margin: "0 0 1.5rem",
    fontSize: "1.8rem",
    fontWeight: 900,
  },
  dialogActions: {
    display: "flex",
    gap: "1rem",
  },
  dialogCancel: {
    flex: 1,
    minHeight: "60px",
    fontSize: "1.2rem",
    fontWeight: 700,
    fontFamily: "inherit",
    color: "var(--ink)",
    background: "#eee",
    border: "none",
    borderRadius: "12px",
    cursor: "pointer",
  },
  dialogConfirm: {
    flex: 1,
    minHeight: "60px",
    fontSize: "1.2rem",
    fontWeight: 700,
    fontFamily: "inherit",
    color: "#fff",
    background: "var(--broth)",
    border: "none",
    borderRadius: "12px",
    cursor: "pointer",
  },
};
