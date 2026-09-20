"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

const ACTIVE_STATUSES = ["received", "cooking"];
const LATE_MINUTES = 15; // รอเกินกี่นาทีให้ตัวเลขเวลารอเป็นสีแดง
const POLL_MS = 60_000; // ดึงข้อมูลซ้ำเป็นตาข่ายนิรภัย เผื่อ WebSocket เงียบไปโดยไม่รู้ตัว
const POLL_RETRY_MS = 5_000; // ถ้าโหลดไม่สำเร็จ ลองใหม่ถี่ขึ้น

function toMs(value) {
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? 0 : ms;
}

// เก่าสุดก่อน (อยู่บนซ้าย), ใหม่สุดอยู่ท้ายสุด (ขวาล่าง)
function sortOrders(list) {
  return [...list].sort((a, b) => {
    const diff = toMs(a.created_at) - toMs(b.created_at);
    if (diff !== 0) return diff;
    return String(a.id).localeCompare(String(b.id));
  });
}

// items เป็น jsonb: [{ name, quantity }] — เผื่อกรณีถูกเก็บเป็นสตริง JSON
function parseItems(raw) {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  return value.map((it) => ({
    name: String(it?.name ?? "(ไม่มีชื่อ)"),
    quantity: Number(it?.quantity) || 1,
  }));
}

function formatTime(value) {
  const ms = toMs(value);
  if (!ms) return "--:--";
  return new Date(ms).toLocaleTimeString("th-TH", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export default function KitchenPage() {
  const [orders, setOrders] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [connected, setConnected] = useState(false);
  const [actionError, setActionError] = useState("");
  const [now, setNow] = useState(() => Date.now());

  // id ของออเดอร์ที่กำลังรอผลการอัปเดต → กันข้อมูลเก่าจาก realtime/ดึงซ้ำมาทับสถานะที่เพิ่งกด
  const pendingRef = useRef(new Map());
  const errorTimer = useRef(null);

  const showActionError = useCallback((text) => {
    clearTimeout(errorTimer.current);
    setActionError(text);
    errorTimer.current = setTimeout(() => setActionError(""), 6000);
  }, []);

  useEffect(() => () => clearTimeout(errorTimer.current), []);

  // ---- 1) โหลดออเดอร์ที่ยังไม่เสร็จ (เก่า → ใหม่) ----
  const fetchOrders = useCallback(async () => {
    const { data, error } = await supabase
      .from("orders")
      .select("id, table_number, items, status, created_at")
      .in("status", ACTIVE_STATUSES)
      .order("created_at", { ascending: true });

    if (error) {
      console.error(error);
      setLoadError(true);
      return;
    }
    setLoadError(false);
    setLoaded(true);
    setOrders((prev) => {
      const pending = pendingRef.current;
      const fromServer = (data ?? []).filter((o) => !pending.has(o.id));
      const localPending = prev.filter((o) => pending.has(o.id));
      return sortOrders([...fromServer, ...localPending]);
    });
  }, []);

  // ---- 2) รับการเปลี่ยนแปลงจาก Realtime ----
  const applyRow = useCallback((row) => {
    if (!row || row.id == null) return;
    if (pendingRef.current.has(row.id)) return;
    setOrders((prev) => {
      const without = prev.filter((o) => o.id !== row.id);
      if (!ACTIVE_STATUSES.includes(row.status)) return without;
      return sortOrders([...without, row]);
    });
  }, []);

  useEffect(() => {
    fetchOrders();

    const channel = supabase
      .channel("kitchen-orders")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "orders" },
        (payload) => applyRow(payload.new)
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "orders" },
        (payload) => applyRow(payload.new)
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setConnected(true);
          // ดึงซ้ำทุกครั้งที่ต่อได้ (รวมถึงต่อใหม่หลังเน็ตหลุด) เพื่อไม่ให้พลาดออเดอร์ช่วงที่ขาด
          fetchOrders();
        } else if (
          status === "CHANNEL_ERROR" ||
          status === "TIMED_OUT" ||
          status === "CLOSED"
        ) {
          setConnected(false);
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchOrders, applyRow]);

  // ดึงซ้ำเป็นระยะ
  useEffect(() => {
    const timer = setInterval(fetchOrders, loadError ? POLL_RETRY_MS : POLL_MS);
    return () => clearInterval(timer);
  }, [fetchOrders, loadError]);

  // อัปเดตเวลา "รอมา N นาที"
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  // กันหน้าจอดับ (ถ้าเบราว์เซอร์รองรับ)
  useEffect(() => {
    let lock = null;
    async function acquire() {
      try {
        if ("wakeLock" in navigator && document.visibilityState === "visible") {
          lock = await navigator.wakeLock.request("screen");
        }
      } catch {
        // ไม่รองรับหรือถูกปฏิเสธ — ข้ามไป
      }
    }
    function onVisible() {
      if (document.visibilityState === "visible") acquire();
    }
    acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      lock?.release?.().catch(() => {});
    };
  }, []);

  // ---- 4) ปุ่มเปลี่ยนสถานะ ----
  async function changeStatus(order, nextStatus) {
    if (pendingRef.current.has(order.id)) return;
    pendingRef.current.set(order.id, nextStatus);

    // อัปเดตหน้าจอทันที
    setOrders((prev) =>
      nextStatus === "served"
        ? prev.filter((o) => o.id !== order.id)
        : prev.map((o) => (o.id === order.id ? { ...o, status: nextStatus } : o))
    );

    try {
      const { data, error } = await supabase
        .from("orders")
        .update({ status: nextStatus })
        .eq("id", order.id)
        .select("id");
      if (error) throw error;
      // RLS ที่ไม่อนุญาต update จะไม่ error แต่ไม่มีแถวถูกแก้
      if (!data || data.length === 0) throw new Error("ไม่มีแถวถูกอัปเดต");
      pendingRef.current.delete(order.id);
    } catch (err) {
      console.error(err);
      pendingRef.current.delete(order.id);
      // คืนการ์ดกลับสถานะเดิม
      setOrders((prev) =>
        sortOrders([...prev.filter((o) => o.id !== order.id), order])
      );
      showActionError(
        `อัปเดตออเดอร์โต๊ะ ${order.table_number} ไม่สำเร็จ กรุณากดอีกครั้ง`
      );
    }
  }

  const receivedCount = orders.filter((o) => o.status === "received").length;
  const cookingCount = orders.filter((o) => o.status === "cooking").length;

  const bannerText = actionError
    ? actionError
    : loadError
      ? "โหลดออเดอร์ไม่สำเร็จ กำลังลองใหม่อัตโนมัติ..."
      : "";

  return (
    <div style={styles.app}>
      <header style={styles.header}>
        <div>
          <h1 style={styles.title}>หน้าครัว</h1>
          <div style={styles.shop}>สุกี้ผีน้อย</div>
        </div>

        <div style={styles.counts}>
          <div style={styles.count}>
            <span style={styles.countNumber}>{receivedCount}</span>
            <span style={styles.countLabel}>รอทำ</span>
          </div>
          <div style={styles.count}>
            <span style={{ ...styles.countNumber, color: "#ffc933" }}>
              {cookingCount}
            </span>
            <span style={styles.countLabel}>กำลังทำ</span>
          </div>
        </div>

        <div
          role="status"
          style={{ ...styles.connection, color: connected ? "#7ee2a0" : "#ff8f8f" }}
        >
          <span aria-hidden="true">● </span>
          {connected ? "เชื่อมต่อแล้ว" : "ขาดการเชื่อมต่อ กำลังต่อใหม่..."}
        </div>
      </header>

      {bannerText && (
        <p role="alert" style={styles.banner}>
          {bannerText}
        </p>
      )}

      <main style={styles.main}>
        {!loaded ? (
          <p style={styles.empty}>กำลังโหลดออเดอร์...</p>
        ) : orders.length === 0 ? (
          <p style={styles.empty}>ยังไม่มีออเดอร์ที่ค้างอยู่</p>
        ) : (
          <ul style={styles.grid}>
            {orders.map((order) => {
              const cooking = order.status === "cooking";
              const minutes = Math.max(
                0,
                Math.floor((now - toMs(order.created_at)) / 60000)
              );
              const late = minutes >= LATE_MINUTES;
              const lines = parseItems(order.items);

              return (
                <li
                  key={order.id}
                  data-status={order.status}
                  style={{
                    ...styles.card,
                    background: cooking ? "#ffc933" : "#fffdf8",
                    borderColor: cooking ? "#e07a00" : "#fffdf8",
                  }}
                >
                  <div style={styles.cardTop}>
                    <div style={styles.tableBlock}>
                      <span style={styles.tableWord}>โต๊ะ</span>
                      <span style={styles.tableNumber}>{order.table_number}</span>
                    </div>
                    <div style={styles.timeBlock}>
                      <span style={styles.time}>{formatTime(order.created_at)}</span>
                      <span
                        style={{
                          ...styles.wait,
                          color: late ? "#b00020" : "var(--ink)",
                          fontWeight: late ? 800 : 600,
                        }}
                      >
                        {minutes < 1 ? "เพิ่งสั่ง" : `รอมา ${minutes} นาที`}
                      </span>
                    </div>
                  </div>

                  <div
                    style={{
                      ...styles.badge,
                      background: cooking ? "var(--ink)" : "transparent",
                      color: cooking ? "#ffc933" : "var(--ink)",
                    }}
                  >
                    {cooking ? "กำลังทำ" : "รอทำ"}
                  </div>

                  <ul style={styles.lines}>
                    {lines.length === 0 ? (
                      <li style={styles.line}>
                        <span>(ไม่มีรายการอาหาร)</span>
                      </li>
                    ) : (
                      lines.map((line, i) => (
                        <li key={i} style={styles.line}>
                          <span style={styles.lineName}>{line.name}</span>
                          <span style={styles.lineQty}>× {line.quantity}</span>
                        </li>
                      ))
                    )}
                  </ul>

                  <div style={styles.actions}>
                    <button
                      type="button"
                      onClick={() => changeStatus(order, "cooking")}
                      disabled={cooking}
                      style={{
                        ...styles.startButton,
                        opacity: cooking ? 0.35 : 1,
                        cursor: cooking ? "default" : "pointer",
                      }}
                    >
                      เริ่มทำ
                    </button>
                    <button
                      type="button"
                      onClick={() => changeStatus(order, "served")}
                      style={styles.serveButton}
                    >
                      จัดเสิร์ฟแล้ว
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}

const styles = {
  app: {
    minHeight: "100vh",
    background: "#241512",
    color: "#fbf7f0",
  },
  header: {
    position: "sticky",
    top: 0,
    zIndex: 10,
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "1rem 2rem",
    padding: "0.75rem 1.5rem",
    background: "#3a1f1b",
    borderBottom: "3px solid var(--broth)",
  },
  title: {
    margin: 0,
    fontSize: "2.2rem",
    fontWeight: 800,
    lineHeight: 1.1,
  },
  shop: {
    fontSize: "1.1rem",
    opacity: 0.8,
  },
  counts: {
    display: "flex",
    gap: "2rem",
  },
  count: {
    display: "flex",
    alignItems: "baseline",
    gap: "0.6rem",
  },
  countNumber: {
    fontSize: "3rem",
    fontWeight: 900,
    lineHeight: 1,
  },
  countLabel: {
    fontSize: "1.5rem",
    fontWeight: 600,
  },
  connection: {
    fontSize: "1.25rem",
    fontWeight: 700,
  },
  banner: {
    margin: 0,
    padding: "0.9rem 1.5rem",
    fontSize: "1.4rem",
    fontWeight: 700,
    color: "#fff",
    background: "#b00020",
  },
  main: {
    padding: "1.25rem 1.5rem 2rem",
  },
  empty: {
    margin: "6rem 0",
    textAlign: "center",
    fontSize: "2.2rem",
    fontWeight: 600,
    opacity: 0.75,
  },
  grid: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))",
    gap: "1.25rem",
    alignItems: "start",
  },
  card: {
    display: "flex",
    flexDirection: "column",
    gap: "0.75rem",
    padding: "1rem 1.25rem 1.25rem",
    color: "var(--ink)",
    border: "5px solid #fffdf8",
    borderRadius: "18px",
  },
  cardTop: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: "1rem",
  },
  tableBlock: {
    display: "flex",
    alignItems: "baseline",
    gap: "0.5rem",
  },
  tableWord: {
    fontSize: "1.8rem",
    fontWeight: 700,
  },
  tableNumber: {
    fontSize: "5rem",
    fontWeight: 900,
    lineHeight: 1,
  },
  timeBlock: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
  },
  time: {
    fontSize: "2.2rem",
    fontWeight: 800,
    lineHeight: 1.2,
  },
  wait: {
    fontSize: "1.25rem",
  },
  badge: {
    alignSelf: "flex-start",
    padding: "0.15rem 0.9rem",
    fontSize: "1.4rem",
    fontWeight: 800,
    border: "3px solid var(--ink)",
    borderRadius: "999px",
  },
  lines: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    borderTop: "3px solid var(--ink)",
  },
  line: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: "1rem",
    padding: "0.55rem 0",
    borderBottom: "1px solid rgba(42, 26, 23, 0.3)",
  },
  lineName: {
    fontSize: "1.75rem",
    fontWeight: 700,
    lineHeight: 1.3,
    minWidth: 0,
  },
  lineQty: {
    flexShrink: 0,
    fontSize: "2.1rem",
    fontWeight: 900,
  },
  actions: {
    display: "flex",
    gap: "0.75rem",
    marginTop: "0.25rem",
  },
  startButton: {
    flex: 1,
    minHeight: "84px",
    fontSize: "1.7rem",
    fontWeight: 800,
    fontFamily: "inherit",
    color: "#fff",
    background: "var(--ink)",
    border: "none",
    borderRadius: "14px",
    touchAction: "manipulation",
  },
  serveButton: {
    flex: 1.2,
    minHeight: "84px",
    fontSize: "1.7rem",
    fontWeight: 800,
    fontFamily: "inherit",
    color: "#fff",
    background: "#1f7a3d",
    border: "none",
    borderRadius: "14px",
    cursor: "pointer",
    touchAction: "manipulation",
  },
};
