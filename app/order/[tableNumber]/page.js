'use client';

import { use, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import styles from './order.module.css';

const MAX_QTY_PER_ITEM = 5;
const MAX_LINE_ITEMS_PER_ORDER = 10;
const ADULT_PRICE = 289;
const CHILD_PRICE = 145;

export default function OrderPage({ params }) {
  // สำคัญ: params เป็น Promise ใน Next.js เวอร์ชันนี้ ต้อง unwrap ด้วย use() เสมอ
  const { tableNumber: tableNumberParam } = use(params);
  const tableNumber = Number(tableNumberParam);

  const [loadingSession, setLoadingSession] = useState(true);
  const [session, setSession] = useState(null);
  const [sessionClosed, setSessionClosed] = useState(false);

  const [categories, setCategories] = useState([]);
  const [menuItems, setMenuItems] = useState([]);
  const [activeCategoryId, setActiveCategoryId] = useState(null);
  const [menuLoading, setMenuLoading] = useState(true);
  const [menuError, setMenuError] = useState('');

  const [cart, setCart] = useState({}); // { [itemId]: { id, name, quantity } }
  const [cartOpen, setCartOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [showSentToast, setShowSentToast] = useState(false);

  const [showBillModal, setShowBillModal] = useState(false);
  const [closingBill, setClosingBill] = useState(false);
  const [billError, setBillError] = useState('');

  // 1. หา session ที่เปิดอยู่ของโต๊ะนี้
  useEffect(() => {
    let active = true;

    async function loadSession() {
      setLoadingSession(true);
      const { data, error } = await supabase
        .from('sessions')
        .select('id, table_number, adult_count, child_count, status')
        .eq('table_number', tableNumber)
        .eq('status', 'open')
        .limit(1);

      if (!active) return;
      if (!error && data && data.length > 0) {
        setSession(data[0]);
      } else {
        setSession(null);
      }
      setLoadingSession(false);
    }

    if (Number.isInteger(tableNumber) && tableNumber > 0) {
      loadSession();
    } else {
      setSession(null);
      setLoadingSession(false);
    }

    return () => {
      active = false;
    };
  }, [tableNumber]);

  // 2. โหลดเมนู หลังจากยืนยันว่ามี session เปิดอยู่
  useEffect(() => {
    if (!session) return;
    let active = true;

    async function loadMenu() {
      setMenuLoading(true);
      setMenuError('');

      const [categoriesRes, itemsRes] = await Promise.all([
        supabase.from('menu_categories').select('id, name, sort_order').order('sort_order', { ascending: true }),
        supabase.from('menu_items').select('id, category_id, name'),
      ]);

      if (!active) return;

      if (categoriesRes.error || itemsRes.error) {
        setMenuError((categoriesRes.error || itemsRes.error).message || 'โหลดเมนูไม่สำเร็จ');
        setMenuLoading(false);
        return;
      }

      const cats = categoriesRes.data || [];
      setCategories(cats);
      setMenuItems(itemsRes.data || []);
      if (cats.length > 0) setActiveCategoryId(cats[0].id);
      setMenuLoading(false);
    }

    loadMenu();
    return () => {
      active = false;
    };
  }, [session]);

  const itemsInActiveCategory = useMemo(
    () => menuItems.filter((item) => item.category_id === activeCategoryId),
    [menuItems, activeCategoryId]
  );

  const cartLines = useMemo(() => Object.values(cart), [cart]);
  const cartLineCount = cartLines.length;
  const cartTotalQuantity = useMemo(
    () => cartLines.reduce((sum, line) => sum + line.quantity, 0),
    [cartLines]
  );

  function incrementItem(item) {
    setCart((prev) => {
      const existing = prev[item.id];
      if (existing) {
        if (existing.quantity >= MAX_QTY_PER_ITEM) return prev;
        return { ...prev, [item.id]: { ...existing, quantity: existing.quantity + 1 } };
      }
      if (Object.keys(prev).length >= MAX_LINE_ITEMS_PER_ORDER) return prev;
      return { ...prev, [item.id]: { id: item.id, name: item.name, quantity: 1 } };
    });
  }

  function decrementItem(itemId) {
    setCart((prev) => {
      const existing = prev[itemId];
      if (!existing) return prev;
      if (existing.quantity <= 1) {
        const next = { ...prev };
        delete next[itemId];
        return next;
      }
      return { ...prev, [itemId]: { ...existing, quantity: existing.quantity - 1 } };
    });
  }

  async function handleSubmitOrder() {
    if (cartLineCount === 0 || !session) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      const { error } = await supabase.from('orders').insert({
        session_id: session.id,
        table_number: session.table_number,
        items: cartLines.map(({ name, quantity }) => ({ name, quantity })),
        status: 'received',
      });
      if (error) throw error;

      setCart({});
      setCartOpen(false);
      setShowSentToast(true);
      setTimeout(() => setShowSentToast(false), 2500);
    } catch (err) {
      setSubmitError(err.message || 'ส่งออเดอร์ไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      setSubmitting(false);
    }
  }

  const billAmount = session
    ? session.adult_count * ADULT_PRICE + session.child_count * CHILD_PRICE
    : 0;

  async function handleConfirmBill() {
    if (!session) return;
    setClosingBill(true);
    setBillError('');
    try {
      const { error } = await supabase
        .from('sessions')
        .update({ status: 'closed' })
        .eq('id', session.id)
        .eq('status', 'open');
      if (error) throw error;

      setShowBillModal(false);
      setSessionClosed(true);
    } catch (err) {
      setBillError(err.message || 'ปิดโต๊ะไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      setClosingBill(false);
    }
  }

  // --- สถานะโหลด ---
  if (loadingSession) {
    return (
      <main className={styles.fullScreen}>
        <p className={styles.fullScreenTitle}>กำลังโหลด...</p>
      </main>
    );
  }

  // --- ปิดโต๊ะแล้ว (เรียกเก็บเงินสำเร็จ) ---
  if (sessionClosed) {
    return (
      <main className={styles.fullScreen}>
        <p className={`${styles.fullScreenTitle} ${styles.thanks}`}>ขอบคุณที่ใช้บริการ</p>
      </main>
    );
  }

  // --- ไม่พบ session ที่เปิดอยู่ ---
  if (!session) {
    return (
      <main className={styles.fullScreen}>
        <p className={styles.fullScreenTitle}>โต๊ะนี้ยังไม่เปิดใช้งาน กรุณาแจ้งพนักงาน</p>
      </main>
    );
  }

  // --- หน้าสั่งอาหาร ---
  return (
    <main className={styles.page}>
      <div className={styles.topBar}>
        <p className={styles.tableLabel}>โต๊ะ {session.table_number}</p>
        <button type="button" className={styles.billButton} onClick={() => setShowBillModal(true)}>
          เรียกเก็บเงิน
        </button>
      </div>

      {menuLoading && <p className={styles.menuNote}>กำลังโหลดเมนู...</p>}
      {menuError && <p className={styles.menuNote}>{menuError}</p>}

      {!menuLoading && !menuError && categories.length === 0 && (
        <p className={styles.menuNote}>ยังไม่มีเมนูในระบบ</p>
      )}

      {categories.length > 0 && (
        <>
          <div className={styles.tabBar}>
            {categories.map((cat) => (
              <button
                key={cat.id}
                type="button"
                className={`${styles.tabButton} ${
                  cat.id === activeCategoryId ? styles.tabButtonActive : ''
                }`}
                onClick={() => setActiveCategoryId(cat.id)}
              >
                {cat.name}
              </button>
            ))}
          </div>

          <div className={styles.menuList}>
            {itemsInActiveCategory.length === 0 && (
              <p className={styles.menuNote}>ยังไม่มีเมนูในหมวดนี้</p>
            )}
            {itemsInActiveCategory.map((item) => {
              const inCart = cart[item.id];
              const atMaxQty = inCart && inCart.quantity >= MAX_QTY_PER_ITEM;
              const cartFull = !inCart && cartLineCount >= MAX_LINE_ITEMS_PER_ORDER;

              return (
                <div key={item.id} className={styles.menuItem}>
                  <p className={styles.menuItemName}>{item.name}</p>
                  {inCart ? (
                    <div className={styles.stepperGroup}>
                      <button
                        type="button"
                        className={`${styles.stepperButton} ${styles.stepperMinus}`}
                        onClick={() => decrementItem(item.id)}
                        aria-label={`ลดจำนวน ${item.name}`}
                      >
                        −
                      </button>
                      <span className={styles.stepperCount}>{inCart.quantity}</span>
                      <button
                        type="button"
                        className={`${styles.stepperButton} ${styles.stepperPlus}`}
                        onClick={() => incrementItem(item)}
                        disabled={atMaxQty}
                        aria-label={`เพิ่มจำนวน ${item.name}`}
                      >
                        +
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className={styles.addButton}
                      onClick={() => incrementItem(item)}
                      disabled={cartFull}
                      aria-label={`เพิ่ม ${item.name} ลงตะกร้า`}
                    >
                      +
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {cartLineCount > 0 && (
        <button type="button" className={styles.cartBar} onClick={() => setCartOpen(true)}>
          <span className={styles.cartBarText}>
            ตะกร้า · {cartLineCount} รายการ ({cartTotalQuantity} ชิ้น)
          </span>
          <span className={styles.cartBarHint}>ดูตะกร้า</span>
        </button>
      )}

      {showSentToast && <div className={styles.toast}>ส่งออเดอร์แล้ว</div>}

      {cartOpen && (
        <div className={styles.cartOverlay} onClick={() => setCartOpen(false)}>
          <div className={styles.cartPanel} onClick={(e) => e.stopPropagation()}>
            <p className={styles.cartPanelTitle}>ตะกร้าของคุณ</p>
            {cartLines.map((line) => (
              <div key={line.id} className={styles.cartLine}>
                <span className={styles.cartLineName}>{line.name}</span>
                <div className={styles.stepperGroup}>
                  <button
                    type="button"
                    className={`${styles.stepperButton} ${styles.stepperMinus}`}
                    onClick={() => decrementItem(line.id)}
                    aria-label={`ลดจำนวน ${line.name}`}
                  >
                    −
                  </button>
                  <span className={styles.stepperCount}>{line.quantity}</span>
                  <button
                    type="button"
                    className={`${styles.stepperButton} ${styles.stepperPlus}`}
                    onClick={() => incrementItem(line)}
                    disabled={line.quantity >= MAX_QTY_PER_ITEM}
                    aria-label={`เพิ่มจำนวน ${line.name}`}
                  >
                    +
                  </button>
                </div>
              </div>
            ))}

            {submitError && <p className={styles.errorText}>{submitError}</p>}

            <div className={styles.cartActions}>
              <button
                type="button"
                className={styles.cartCancelButton}
                onClick={() => setCartOpen(false)}
                disabled={submitting}
              >
                สั่งเพิ่ม
              </button>
              <button
                type="button"
                className={styles.cartSubmitButton}
                onClick={handleSubmitOrder}
                disabled={submitting}
              >
                {submitting ? 'กำลังส่ง...' : 'ส่งออเดอร์'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showBillModal && (
        <div className={styles.overlay}>
          <div className={styles.modal}>
            <p className={styles.modalTitle}>ยืนยันเรียกเก็บเงิน</p>
            <p className={styles.modalAmount}>{billAmount.toLocaleString('th-TH')} บาท</p>
            <p className={styles.modalBreakdown}>
              ผู้ใหญ่ {session.adult_count} × {ADULT_PRICE} บาท
              <br />
              เด็ก {session.child_count} × {CHILD_PRICE} บาท
            </p>
            {billError && <p className={styles.errorText}>{billError}</p>}
            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.cancelButton}
                onClick={() => setShowBillModal(false)}
                disabled={closingBill}
              >
                ยกเลิก
              </button>
              <button
                type="button"
                className={styles.confirmButton}
                onClick={handleConfirmBill}
                disabled={closingBill}
              >
                {closingBill ? 'กำลังปิด...' : 'ยืนยัน'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
