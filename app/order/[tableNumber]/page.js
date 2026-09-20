"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

// ---- ค่าคงที่ของร้าน ----
const ADULT_PRICE = 289;
const CHILD_PRICE = 145;
const MAX_QTY_PER_ITEM = 5; // สั่งเมนูเดียวกันได้สูงสุดกี่ที่
const MAX_ITEMS_PER_ORDER = 10; // กี่รายการ (เมนูต่างกัน) ต่อการส่ง 1 ครั้ง

const formatBaht = (n) => n.toLocaleString("th-TH");

export default function OrderPage() {
  const params = useParams();
  const tableParam = String(params.table ?? "");
  const tableValid = /^\d+$/.test(tableParam) && Number(tableParam) >= 1;
  const tableNumber = tableValid ? Number(tableParam) : null;

  // loading | error | notOpen | ready | closed
  const [phase, setPhase] = useState("loading");
  const [session, setSession] = useState(null); // { id, adult_count, child_count }

  // idle | loading | ready | error
  const [menuStatus, setMenuStatus] = useState("idle");
  const [categories, setCategories] = useState([]);
  const [items, setItems] = useState([]);
  const [activeCat, setActiveCat] = useState(null);

  const [cart, setCart] = useState([]); // [{ id, name, quantity }]
  const [cartOpen, setCartOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [toast, setToast] = useState(null); // { type: "ok" | "warn", text }

  const [billOpen, setBillOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState("");

  const toastTimer = useRef(null);

  const showToast = useCallback((type, text) => {
    clearTimeout(toastTimer.current);
    setToast({ type, text });
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  // ---- 1) เช็คว่าโต๊ะเปิดอยู่หรือไม่ ----
  const loadSession = useCallback(async () => {
    if (tableNumber === null) {
      setPhase("notOpen");
      return;
    }
    setPhase("loading");
    const { data, error } = await supabase
      .from("sessions")
      .select("id, adult_count, child_count")
      .eq("table_number", tableNumber)
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(1);

    if (error) {
      console.error(error);
      setPhase("error");
      return;
    }
    if (!data || data.length === 0) {
      setPhase("notOpen");
      return;
    }
    setSession(data[0]);
    setPhase("ready");
  }, [tableNumber]);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  // ---- 2) โหลดเมนู (เฉพาะเมื่อโต๊ะเปิดอยู่) ----
  const loadMenu = useCallback(async () => {
    setMenuStatus("loading");
    const [cats, its] = await Promise.all([
      supabase
        .from("menu_categories")
        .select("id, name, sort_order")
        .order("sort_order", { ascending: true }),
      supabase
        .from("menu_items")
        .select("id, category_id, name")
        .order("id", { ascending: true }),
    ]);

    if (cats.error || its.error) {
      console.error(cats.error || its.error);
      setMenuStatus("error");
      return;
    }
    const catList = cats.data ?? [];
    setCategories(catList);
    setItems(its.data ?? []);
    setActiveCat(catList.length > 0 ? catList[0].id : null);
    setMenuStatus("ready");
  }, []);

  useEffect(() => {
    if (phase === "ready") loadMenu();
  }, [phase, loadMenu]);

  // ---- ตะกร้า ----
  const qtyById = useMemo(() => {
    const map = new Map();
    cart.forEach((c) => map.set(c.id, c.quantity));
    return map;
  }, [cart]);

  const totalPieces = cart.reduce((sum, c) => sum + c.quantity, 0);
  const cartFull = cart.length >= MAX_ITEMS_PER_ORDER;

  function isAddBlocked(itemId) {
    const qty = qtyById.get(itemId) ?? 0;
    return qty > 0 ? qty >= MAX_QTY_PER_ITEM : cartFull;
  }

  function addItem(item) {
    const qty = qtyById.get(item.id) ?? 0;
    if (qty >= MAX_QTY_PER_ITEM) {
      showToast("warn", `สั่งได้สูงสุด ${MAX_QTY_PER_ITEM} ที่ต่อเมนู`);
      return;
    }
    if (qty === 0 && cartFull) {
      showToast(
        "warn",
        `เลือกได้สูงสุด ${MAX_ITEMS_PER_ORDER} รายการต่อครั้ง ส่งออเดอร์ก่อนแล้วสั่งเพิ่มได้เลย`
      );
      return;
    }
    setSendError("");
    setCart((prev) =>
      qty === 0
        ? [...prev, { id: item.id, name: item.name, quantity: 1 }]
        : prev.map((c) =>
            c.id === item.id ? { ...c, quantity: c.quantity + 1 } : c
          )
    );
  }

  function decreaseItem(itemId) {
    setSendError("");
    setCart((prev) =>
      prev.flatMap((c) => {
        if (c.id !== itemId) return [c];
        return c.quantity > 1 ? [{ ...c, quantity: c.quantity - 1 }] : [];
      })
    );
  }

  // ---- ส่งออเดอร์ ----
  async function sendOrder() {
    if (sending || cart.length === 0 || !session) return;
    setSending(true);
    setSendError("");
    try {
      // กันกรณีโต๊ะถูกปิดไปแล้ว (เช่นเพื่อนร่วมโต๊ะกดเรียกเก็บเงินจากเครื่องอื่น)
      const { data: stillOpen, error: checkError } = await supabase
        .from("sessions")
        .select("id")
        .eq("id", session.id)
        .eq("status", "open")
        .limit(1);
      if (checkError) throw checkError;
      if (!stillOpen || stillOpen.length === 0) {
        setCartOpen(false);
        setPhase("notOpen");
        return;
      }

      const { error: insertError } = await supabase.from("orders").insert({
        session_id: session.id,
        table_number: tableNumber,
        items: cart.map(({ name, quantity }) => ({ name, quantity })),
        status: "received",
      });
      if (insertError) throw insertError;

      setCart([]);
      setCartOpen(false);
      showToast("ok", "ส่งออเดอร์แล้ว");
    } catch (err) {
      console.error(err);
      setSendError("ส่งออเดอร์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setSending(false);
    }
  }

  // ---- เรียกเก็บเงิน ----
  const adultCount = Number(session?.adult_count) || 0;
  const childCount = Number(session?.child_count) || 0;
  const adultTotal = adultCount * ADULT_PRICE;
  const childTotal = childCount * CHILD_PRICE;
  const grandTotal = adultTotal + childTotal;

  async function confirmClose() {
    if (closing || !session) return;
    setClosing(true);
    setCloseError("");
    try {
      const { data, error } = await supabase
        .from("sessions")
        .update({ status: "closed" })
        .eq("id", session.id)
        .select("id");
      if (error) throw error;
      // RLS ที่ไม่อนุญาต update จะไม่ error แต่ไม่มีแถวถูกอัปเดต
      if (!data || data.length === 0) {
        throw new Error("ไม่มีแถวถูกอัปเดต");
      }
      setBillOpen(false);
      setCartOpen(false);
      setCart([]);
      setPhase("closed");
    } catch (err) {
      console.error(err);
      setCloseError("ปิดโต๊ะไม่สำเร็จ กรุณาลองใหม่หรือแจ้งพนักงาน");
    } finally {
      setClosing(false);
    }
  }

  const sheetVisible = cartOpen && cart.length > 0;

  // ล็อกการเลื่อนหน้าด้านหลังตอนเปิดตะกร้า/หน้าต่างยืนยัน
  useEffect(() => {
    if (!sheetVisible && !billOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [sheetVisible, billOpen]);

  // กด Esc เพื่อปิดหน้าต่างยืนยัน
  useEffect(() => {
    if (!billOpen) return;
    function onKey(e) {
      if (e.key === "Escape" && !closing) setBillOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [billOpen, closing]);

  // ---- หน้าเต็มจอตามสถานะ ----
  if (phase === "loading") {
    return <FullMessage title="กำลังโหลด..." />;
  }
  if (phase === "error") {
    return (
      <FullMessage
        title="โหลดข้อมูลไม่สำเร็จ"
        detail="กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองอีกครั้ง"
        actionLabel="ลองอีกครั้ง"
        onAction={loadSession}
      />
    );
  }
  if (phase === "notOpen") {
    return <FullMessage title="โต๊ะนี้ยังไม่เปิดใช้งาน กรุณาแจ้งพนักงาน" />;
  }
  if (phase === "closed") {
    return <FullMessage title="ขอบคุณที่ใช้บริการ" tone="thanks" />;
  }

  // ---- หน้าสั่งอาหาร ----
  const visibleItems = items.filter((i) => i.category_id === activeCat);
  const activeCategory = categories.find((c) => c.id === activeCat);

  return (
    <div style={styles.app}>
      <div style={styles.stickyTop}>
        <header style={styles.header}>
          <div>
            <div style={styles.brand}>สุกี้ผีน้อย</div>
            <div style={styles.tableLabel}>โต๊ะ {tableNumber}</div>
          </div>
          <button
            type="button"
            onClick={() => {
              setCloseError("");
              setBillOpen(true);
            }}
            style={styles.billButton}
          >
            เรียกเก็บเงิน
          </button>
        </header>

        {menuStatus === "ready" && categories.length > 0 && (
          <div role="tablist" aria-label="หมวดหมู่เมนู" style={styles.tabs}>
            {categories.map((cat) => {
              const active = cat.id === activeCat;
              return (
                <button
                  key={cat.id}
                  type="button"
                  role="tab"
                  id={`tab-${cat.id}`}
                  aria-selected={active}
                  aria-controls="menu-panel"
                  onClick={() => setActiveCat(cat.id)}
                  style={{
                    ...styles.tab,
                    color: active ? "var(--broth)" : "var(--ink)",
                    borderBottomColor: active ? "var(--broth)" : "transparent",
                  }}
                >
                  {cat.name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <main style={styles.main}>
        {menuStatus === "loading" || menuStatus === "idle" ? (
          <p style={styles.hint}>กำลังโหลดเมนู...</p>
        ) : menuStatus === "error" ? (
          <div style={styles.hintBox}>
            <p style={styles.hint}>โหลดเมนูไม่สำเร็จ</p>
            <button type="button" onClick={loadMenu} style={styles.retryButton}>
              ลองอีกครั้ง
            </button>
          </div>
        ) : categories.length === 0 ? (
          <p style={styles.hint}>ยังไม่มีเมนู กรุณาแจ้งพนักงาน</p>
        ) : (
          <section
            id="menu-panel"
            role="tabpanel"
            aria-labelledby={`tab-${activeCat}`}
          >
            <h2 style={styles.categoryTitle}>{activeCategory?.name}</h2>

            {visibleItems.length === 0 ? (
              <p style={styles.hint}>หมวดนี้ยังไม่มีเมนู</p>
            ) : (
              <ul style={styles.list}>
                {visibleItems.map((item) => {
                  const qty = qtyById.get(item.id) ?? 0;
                  return (
                    <li key={item.id} style={styles.row}>
                      <div style={styles.rowName}>
                        <span style={styles.itemName}>{item.name}</span>
                        <span aria-hidden="true" style={styles.leader} />
                      </div>
                      <Stepper
                        name={item.name}
                        qty={qty}
                        onInc={() => addItem(item)}
                        onDec={() => decreaseItem(item.id)}
                        incBlocked={isAddBlocked(item.id)}
                      />
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}
      </main>

      {toast && (
        <div
          role="status"
          style={{
            ...styles.toast,
            background: toast.type === "ok" ? "#1f5b32" : "var(--ladle)",
            color: toast.type === "ok" ? "#fff" : "var(--ink)",
          }}
        >
          {toast.type === "ok" ? "✓ " : ""}
          {toast.text}
        </div>
      )}

      {/* ตะกร้าลอยด้านล่างจอ */}
      <div style={styles.cartBarWrap}>
        <div style={styles.cartBarInner}>
          <button
            type="button"
            disabled={cart.length === 0}
            onClick={() => setCartOpen(true)}
            style={{
              ...styles.cartBar,
              background: cart.length === 0 ? "#d9cfc4" : "var(--broth)",
              color: cart.length === 0 ? "#6b5b55" : "#fff",
              cursor: cart.length === 0 ? "default" : "pointer",
            }}
          >
            {cart.length === 0 ? (
              <span>ยังไม่ได้เลือกรายการ</span>
            ) : (
              <>
                <span>
                  ตะกร้า · {cart.length} รายการ
                  <span style={styles.cartSub}> (รวม {totalPieces} ที่)</span>
                </span>
                <span>ดูตะกร้า</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* รายการในตะกร้า + ปุ่มส่งออเดอร์ */}
      {sheetVisible && (
        <div style={styles.overlay} onClick={() => !sending && setCartOpen(false)}>
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="cart-title"
            style={styles.sheet}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={styles.sheetHead}>
              <h2 id="cart-title" style={styles.sheetTitle}>
                ตะกร้า ({cart.length}/{MAX_ITEMS_PER_ORDER} รายการ)
              </h2>
              <button
                type="button"
                onClick={() => setCartOpen(false)}
                disabled={sending}
                style={styles.textButton}
              >
                ปิด
              </button>
            </div>

            <ul style={styles.sheetList}>
              {cart.map((c) => (
                <li key={c.id} style={styles.sheetRow}>
                  <span style={styles.sheetItemName}>{c.name}</span>
                  <Stepper
                    name={c.name}
                    qty={c.quantity}
                    onInc={() => addItem(c)}
                    onDec={() => decreaseItem(c.id)}
                    incBlocked={c.quantity >= MAX_QTY_PER_ITEM}
                  />
                </li>
              ))}
            </ul>

            <div style={styles.sheetFoot}>
              {sendError && (
                <p role="alert" style={styles.errorBox}>
                  {sendError}
                </p>
              )}
              <button
                type="button"
                onClick={sendOrder}
                disabled={sending}
                style={{
                  ...styles.sendButton,
                  opacity: sending ? 0.6 : 1,
                  cursor: sending ? "wait" : "pointer",
                }}
              >
                {sending ? "กำลังส่ง..." : "ส่งออเดอร์"}
              </button>
            </div>
          </section>
        </div>
      )}

      {/* หน้าต่างยืนยันเรียกเก็บเงิน */}
      {billOpen && (
        <div
          style={{ ...styles.overlay, alignItems: "center" }}
          onClick={() => !closing && setBillOpen(false)}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="bill-title"
            style={styles.dialog}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="bill-title" style={styles.dialogTitle}>
              เรียกเก็บเงิน · โต๊ะ {tableNumber}
            </h2>

            <dl style={styles.billLines}>
              <div style={styles.billLine}>
                <dt>
                  ผู้ใหญ่ {adultCount} × {ADULT_PRICE}
                </dt>
                <dd style={styles.billValue}>{formatBaht(adultTotal)} บาท</dd>
              </div>
              <div style={styles.billLine}>
                <dt>
                  เด็ก {childCount} × {CHILD_PRICE}
                </dt>
                <dd style={styles.billValue}>{formatBaht(childTotal)} บาท</dd>
              </div>
            </dl>

            <div style={styles.billTotal}>
              <span>ยอดที่ต้องจ่าย</span>
              <strong style={styles.billTotalValue}>
                {formatBaht(grandTotal)} บาท
              </strong>
            </div>

            <p style={styles.dialogNote}>
              หลังยืนยัน จะสั่งอาหารเพิ่มไม่ได้อีก
              {cart.length > 0 &&
                ` และรายการในตะกร้า ${cart.length} รายการที่ยังไม่ได้ส่งจะไม่ถูกส่ง`}
            </p>

            {closeError && (
              <p role="alert" style={styles.errorBox}>
                {closeError}
              </p>
            )}

            <div style={styles.dialogActions}>
              <button
                type="button"
                onClick={() => setBillOpen(false)}
                disabled={closing}
                style={styles.cancelButton}
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={confirmClose}
                disabled={closing}
                style={{
                  ...styles.confirmButton,
                  opacity: closing ? 0.6 : 1,
                  cursor: closing ? "wait" : "pointer",
                }}
              >
                {closing ? "กำลังดำเนินการ..." : "ยืนยัน"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

// ปุ่ม + / − สำหรับเมนู (ไม่มีในตะกร้า = โชว์แค่ปุ่ม +)
function Stepper({ name, qty, onInc, onDec, incBlocked }) {
  const plus = (
    <button
      type="button"
      aria-label={`เพิ่ม ${name}`}
      aria-disabled={incBlocked}
      onClick={onInc}
      style={{
        ...styles.roundButton,
        background: incBlocked ? "#d9cfc4" : "var(--broth)",
        color: incBlocked ? "#6b5b55" : "#fff",
      }}
    >
      +
    </button>
  );

  if (qty === 0) return plus;

  return (
    <div style={styles.stepper}>
      <button
        type="button"
        aria-label={`ลด ${name}`}
        onClick={onDec}
        style={{
          ...styles.roundButton,
          background: "transparent",
          color: "var(--broth)",
          border: "2px solid var(--broth)",
        }}
      >
        −
      </button>
      <span style={styles.qty} aria-live="polite">
        {qty}
      </span>
      {plus}
    </div>
  );
}

function FullMessage({ title, detail, actionLabel, onAction, tone }) {
  return (
    <main
      style={{
        ...styles.fullScreen,
        background: tone === "thanks" ? "var(--broth)" : "var(--steam)",
        color: tone === "thanks" ? "#fff" : "var(--ink)",
      }}
    >
      <h1 style={styles.fullTitle}>{title}</h1>
      {detail && <p style={styles.fullDetail}>{detail}</p>}
      {actionLabel && (
        <button type="button" onClick={onAction} style={styles.retryButton}>
          {actionLabel}
        </button>
      )}
    </main>
  );
}

const SAFE_BOTTOM = "env(safe-area-inset-bottom, 0px)";

const styles = {
  app: {
    minHeight: "100vh",
    maxWidth: "640px",
    margin: "0 auto",
    background: "var(--steam)",
  },

  // ส่วนหัว + แท็บ
  stickyTop: {
    position: "sticky",
    top: 0,
    zIndex: 10,
    background: "var(--steam)",
    borderBottom: "2px solid var(--ink)",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "1rem",
    padding: "0.75rem 1rem 0.5rem",
  },
  brand: {
    fontSize: "1rem",
    color: "var(--broth)",
    fontWeight: 700,
    lineHeight: 1.2,
  },
  tableLabel: {
    fontSize: "1.9rem",
    fontWeight: 800,
    lineHeight: 1.2,
  },
  billButton: {
    minHeight: "48px",
    padding: "0.4rem 1rem",
    fontSize: "1.1rem",
    fontWeight: 700,
    fontFamily: "inherit",
    color: "var(--broth)",
    background: "transparent",
    border: "2px solid var(--broth)",
    borderRadius: "10px",
    cursor: "pointer",
    touchAction: "manipulation",
  },
  tabs: {
    display: "flex",
    gap: "0.25rem",
    overflowX: "auto",
    padding: "0 0.5rem",
  },
  tab: {
    flex: "0 0 auto",
    minHeight: "52px",
    padding: "0.5rem 0.9rem",
    fontSize: "1.2rem",
    fontWeight: 700,
    fontFamily: "inherit",
    background: "transparent",
    border: "none",
    borderBottom: "4px solid transparent",
    whiteSpace: "nowrap",
    cursor: "pointer",
    touchAction: "manipulation",
  },

  // รายการเมนู
  main: {
    padding: "1.25rem 1rem 9rem",
  },
  categoryTitle: {
    margin: "0 0 0.5rem",
    paddingBottom: "0.6rem",
    fontSize: "1.7rem",
    fontWeight: 800,
    color: "var(--broth)",
    borderBottom: "3px double var(--ink)",
  },
  list: {
    listStyle: "none",
    margin: 0,
    padding: 0,
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    padding: "0.75rem 0",
  },
  rowName: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    alignItems: "baseline",
    gap: "0.5rem",
  },
  itemName: {
    flex: "0 1 auto",
    fontSize: "1.3rem",
    fontWeight: 600,
    lineHeight: 1.35,
  },
  leader: {
    flex: "1 1 12px",
    minWidth: "12px",
    borderBottom: "2px dotted rgba(42, 26, 23, 0.4)",
  },
  hint: {
    margin: "2rem 0",
    textAlign: "center",
    fontSize: "1.2rem",
  },
  hintBox: {
    textAlign: "center",
  },

  // ปุ่ม + / −
  stepper: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    flexShrink: 0,
  },
  roundButton: {
    width: "56px",
    height: "56px",
    flexShrink: 0,
    fontSize: "2rem",
    lineHeight: 1,
    fontWeight: 600,
    fontFamily: "inherit",
    color: "#fff",
    background: "var(--broth)",
    border: "2px solid transparent",
    borderRadius: "50%",
    cursor: "pointer",
    touchAction: "manipulation",
  },
  qty: {
    minWidth: "2ch",
    textAlign: "center",
    fontSize: "1.6rem",
    fontWeight: 800,
  },

  // แจ้งเตือนชั่วคราว
  toast: {
    position: "fixed",
    left: "1rem",
    right: "1rem",
    bottom: `calc(6.5rem + ${SAFE_BOTTOM})`,
    maxWidth: "608px",
    margin: "0 auto",
    padding: "0.9rem 1.1rem",
    fontSize: "1.2rem",
    fontWeight: 700,
    textAlign: "center",
    borderRadius: "12px",
    zIndex: 40,
    boxShadow: "0 4px 14px rgba(0,0,0,0.25)",
  },

  // ตะกร้าลอย
  cartBarWrap: {
    position: "fixed",
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 20,
    padding: `0.75rem 1rem calc(0.75rem + ${SAFE_BOTTOM})`,
    background: "linear-gradient(to top, var(--steam) 70%, rgba(251,247,240,0))",
    pointerEvents: "none",
  },
  cartBarInner: {
    maxWidth: "608px",
    margin: "0 auto",
    pointerEvents: "auto",
  },
  cartBar: {
    width: "100%",
    minHeight: "64px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "1rem",
    padding: "0.5rem 1.25rem",
    fontSize: "1.3rem",
    fontWeight: 700,
    fontFamily: "inherit",
    border: "none",
    borderRadius: "16px",
    touchAction: "manipulation",
  },
  cartSub: {
    fontSize: "1rem",
    fontWeight: 500,
    opacity: 0.9,
  },

  // Overlay / bottom sheet / dialog
  overlay: {
    position: "fixed",
    inset: 0,
    zIndex: 30,
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "center",
    background: "rgba(42, 26, 23, 0.55)",
  },
  sheet: {
    width: "100%",
    maxWidth: "640px",
    maxHeight: "80vh",
    display: "flex",
    flexDirection: "column",
    background: "var(--steam)",
    borderRadius: "20px 20px 0 0",
  },
  sheetHead: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "1rem 1.25rem 0.5rem",
  },
  sheetTitle: {
    margin: 0,
    fontSize: "1.5rem",
    fontWeight: 800,
    color: "var(--broth)",
  },
  textButton: {
    minHeight: "48px",
    padding: "0 0.75rem",
    fontSize: "1.2rem",
    fontWeight: 600,
    fontFamily: "inherit",
    color: "var(--ink)",
    background: "transparent",
    border: "none",
    cursor: "pointer",
  },
  sheetList: {
    listStyle: "none",
    margin: 0,
    padding: "0 1.25rem",
    overflowY: "auto",
    flex: 1,
  },
  sheetRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.75rem",
    padding: "0.6rem 0",
    borderBottom: "1px solid rgba(42, 26, 23, 0.2)",
  },
  sheetItemName: {
    fontSize: "1.25rem",
    fontWeight: 600,
    lineHeight: 1.35,
    minWidth: 0,
  },
  sheetFoot: {
    padding: `0.75rem 1.25rem calc(1rem + ${SAFE_BOTTOM})`,
    display: "flex",
    flexDirection: "column",
    gap: "0.75rem",
  },
  sendButton: {
    minHeight: "72px",
    width: "100%",
    fontSize: "1.7rem",
    fontWeight: 800,
    fontFamily: "inherit",
    color: "#fff",
    background: "var(--broth)",
    border: "none",
    borderRadius: "16px",
    touchAction: "manipulation",
  },
  errorBox: {
    margin: 0,
    padding: "0.8rem 1rem",
    fontSize: "1.15rem",
    fontWeight: 600,
    color: "#b00020",
    background: "#fdecec",
    border: "2px solid #b00020",
    borderRadius: "12px",
  },
  dialog: {
    width: "calc(100% - 2rem)",
    maxWidth: "440px",
    margin: "0 1rem",
    padding: "1.5rem 1.25rem",
    background: "var(--steam)",
    borderRadius: "20px",
    display: "flex",
    flexDirection: "column",
    gap: "1rem",
  },
  dialogTitle: {
    margin: 0,
    fontSize: "1.5rem",
    fontWeight: 800,
    color: "var(--broth)",
  },
  billLines: {
    margin: 0,
    display: "flex",
    flexDirection: "column",
    gap: "0.4rem",
    fontSize: "1.25rem",
  },
  billLine: {
    display: "flex",
    justifyContent: "space-between",
    gap: "1rem",
  },
  billValue: {
    margin: 0,
    fontWeight: 600,
  },
  billTotal: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: "1rem",
    paddingTop: "0.8rem",
    fontSize: "1.3rem",
    borderTop: "3px double var(--ink)",
  },
  billTotalValue: {
    fontSize: "2.2rem",
    color: "var(--broth)",
  },
  dialogNote: {
    margin: 0,
    fontSize: "1.05rem",
    lineHeight: 1.5,
  },
  dialogActions: {
    display: "flex",
    gap: "0.75rem",
  },
  cancelButton: {
    flex: 1,
    minHeight: "64px",
    fontSize: "1.3rem",
    fontWeight: 700,
    fontFamily: "inherit",
    color: "var(--ink)",
    background: "transparent",
    border: "2px solid var(--ink)",
    borderRadius: "14px",
    cursor: "pointer",
    touchAction: "manipulation",
  },
  confirmButton: {
    flex: 1.4,
    minHeight: "64px",
    fontSize: "1.3rem",
    fontWeight: 800,
    fontFamily: "inherit",
    color: "#fff",
    background: "var(--broth)",
    border: "2px solid var(--broth)",
    borderRadius: "14px",
    touchAction: "manipulation",
  },

  // หน้าเต็มจอ
  fullScreen: {
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "1.25rem",
    padding: "2rem",
    textAlign: "center",
  },
  fullTitle: {
    margin: 0,
    fontSize: "clamp(1.8rem, 7vw, 2.6rem)",
    fontWeight: 800,
    lineHeight: 1.4,
  },
  fullDetail: {
    margin: 0,
    fontSize: "1.2rem",
  },
  retryButton: {
    minHeight: "56px",
    padding: "0.5rem 1.75rem",
    fontSize: "1.25rem",
    fontWeight: 700,
    fontFamily: "inherit",
    color: "#fff",
    background: "var(--broth)",
    border: "none",
    borderRadius: "14px",
    cursor: "pointer",
    touchAction: "manipulation",
  },
};
