'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '../../lib/supabaseClient';
import styles from './kitchen.module.css';

const ACTIVE_STATUSES = ['received', 'cooking'];

function sortByCreatedAt(orders) {
  return [...orders].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
}

function formatTime(isoDate) {
  return new Date(isoDate).toLocaleTimeString('th-TH', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function KitchenPage() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isLive, setIsLive] = useState(false);
  const [busyOrderIds, setBusyOrderIds] = useState({});

  // เก็บ id ที่ optimistic-update ไว้ในเครื่อง กันไม่ให้ realtime event มาทับซ้ำผิดจังหวะ
  const orderIdsRef = useRef(new Set());

  useEffect(() => {
    orderIdsRef.current = new Set(orders.map((o) => o.id));
  }, [orders]);

  // 1. โหลดออเดอร์ที่ยังค้างอยู่ตอนเปิดหน้าครั้งแรก
  useEffect(() => {
    let active = true;

    async function loadInitialOrders() {
      setLoading(true);
      const { data, error } = await supabase
        .from('orders')
        .select('id, table_number, items, status, created_at')
        .in('status', ACTIVE_STATUSES)
        .order('created_at', { ascending: true });

      if (!active) return;
      if (!error && data) {
        setOrders(sortByCreatedAt(data));
      }
      setLoading(false);
    }

    loadInitialOrders();
    return () => {
      active = false;
    };
  }, []);

  const handleInsert = useCallback((payload) => {
    const newOrder = payload.new;
    if (!ACTIVE_STATUSES.includes(newOrder.status)) return;
    if (orderIdsRef.current.has(newOrder.id)) return;
    setOrders((prev) => sortByCreatedAt([...prev, newOrder]));
  }, []);

  const handleUpdate = useCallback((payload) => {
    const updated = payload.new;

    setOrders((prev) => {
      if (updated.status === 'served') {
        return prev.filter((o) => o.id !== updated.id);
      }
      const exists = prev.some((o) => o.id === updated.id);
      if (exists) {
        return prev.map((o) => (o.id === updated.id ? { ...o, ...updated } : o));
      }
      if (ACTIVE_STATUSES.includes(updated.status)) {
        return sortByCreatedAt([...prev, updated]);
      }
      return prev;
    });
  }, []);

  // 2. Subscribe การเปลี่ยนแปลงของตาราง orders แบบ realtime
  useEffect(() => {
    const channel = supabase
      .channel('kitchen-orders')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, handleInsert)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, handleUpdate)
      .subscribe((status) => {
        setIsLive(status === 'SUBSCRIBED');
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [handleInsert, handleUpdate]);

  function setBusy(orderId, value) {
    setBusyOrderIds((prev) => ({ ...prev, [orderId]: value }));
  }

  async function handleStartCooking(order) {
    setBusy(order.id, true);
    // อัปเดตหน้าจอทันทีเพื่อความไว ไม่ต้องรอ round-trip
    setOrders((prev) => prev.map((o) => (o.id === order.id ? { ...o, status: 'cooking' } : o)));
    const { error } = await supabase
      .from('orders')
      .update({ status: 'cooking' })
      .eq('id', order.id)
      .eq('status', 'received');
    if (error) {
      // ย้อนกลับถ้าอัปเดตไม่สำเร็จ
      setOrders((prev) => prev.map((o) => (o.id === order.id ? { ...o, status: 'received' } : o)));
    }
    setBusy(order.id, false);
  }

  async function handleServed(order) {
    setBusy(order.id, true);
    // เอาการ์ดออกจากจอทันที
    setOrders((prev) => prev.filter((o) => o.id !== order.id));
    const { error } = await supabase
      .from('orders')
      .update({ status: 'served' })
      .eq('id', order.id)
      .in('status', ACTIVE_STATUSES);
    if (error) {
      // ถ้าอัปเดตไม่สำเร็จ เอาการ์ดกลับขึ้นจอ
      setOrders((prev) => sortByCreatedAt([...prev, order]));
    }
    setBusy(order.id, false);
  }

  return (
    <main className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>จอครัว · สุกี้ผีน้อย</h1>
        <span className={`${styles.connectionStatus} ${isLive ? styles.live : ''}`}>
          {isLive ? '● เชื่อมต่อแล้ว' : '○ กำลังเชื่อมต่อ...'}
        </span>
      </div>

      {loading && <p className={styles.emptyState}>กำลังโหลดออเดอร์...</p>}

      {!loading && orders.length === 0 && (
        <p className={styles.emptyState}>ยังไม่มีออเดอร์ค้าง</p>
      )}

      {!loading && orders.length > 0 && (
        <div className={styles.grid}>
          {orders.map((order) => {
            const isCooking = order.status === 'cooking';
            const isBusy = Boolean(busyOrderIds[order.id]);
            const items = Array.isArray(order.items) ? order.items : [];

            return (
              <div key={order.id} className={`${styles.card} ${isCooking ? styles.cardCooking : ''}`}>
                <div className={styles.cardTop}>
                  <p className={styles.tableNumber}>โต๊ะ {order.table_number}</p>
                  <span className={styles.orderTime}>{formatTime(order.created_at)}</span>
                </div>

                <span className={styles.statusLabel}>
                  {isCooking ? 'กำลังทำ' : 'ยังไม่เริ่ม'}
                </span>

                <ul className={styles.itemList}>
                  {items.map((item, index) => (
                    <li key={`${order.id}-${index}`} className={styles.itemLine}>
                      <span>{item.name}</span>
                      <span className={styles.itemQty}>x{item.quantity}</span>
                    </li>
                  ))}
                </ul>

                <div className={styles.cardActions}>
                  {!isCooking && (
                    <button
                      type="button"
                      className={styles.startButton}
                      onClick={() => handleStartCooking(order)}
                      disabled={isBusy}
                    >
                      เริ่มทำ
                    </button>
                  )}
                  <button
                    type="button"
                    className={styles.serveButton}
                    onClick={() => handleServed(order)}
                    disabled={isBusy}
                  >
                    จัดเสิร์ฟแล้ว
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
