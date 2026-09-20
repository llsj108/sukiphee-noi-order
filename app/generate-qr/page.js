'use client';

import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabaseClient';
import styles from './generate-qr.module.css';

const QR_ENDPOINT = 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=';

function emptyForm() {
  return { tableNumber: '', adultCount: '', childCount: '' };
}

function minutesSince(isoDate) {
  const start = new Date(isoDate).getTime();
  const now = Date.now();
  return Math.max(0, Math.floor((now - start) / 60000));
}

export default function GenerateQrPage() {
  const [form, setForm] = useState(emptyForm());
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Session เก่าที่ยังเปิดอยู่ (ทำให้เกิดกล่องเตือน)
  const [openSession, setOpenSession] = useState(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [closingSession, setClosingSession] = useState(false);
  const [confirmError, setConfirmError] = useState('');

  // ตัวเลขนาทีที่แสดงในกล่องยืนยัน อัปเดตทุก 30 วินาทีระหว่างที่กล่องเปิดอยู่
  const [elapsedMinutes, setElapsedMinutes] = useState(0);

  // ผลลัพธ์หลังเปิดโต๊ะสำเร็จ
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!showConfirm || !openSession) return;
    setElapsedMinutes(minutesSince(openSession.created_at));
    const timer = setInterval(() => {
      setElapsedMinutes(minutesSince(openSession.created_at));
    }, 30000);
    return () => clearInterval(timer);
  }, [showConfirm, openSession]);

  function handleChange(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function validate() {
    const tableNumber = Number(form.tableNumber);
    const adultCount = Number(form.adultCount);
    const childCount = Number(form.childCount);

    if (!form.tableNumber || !Number.isInteger(tableNumber) || tableNumber <= 0) {
      return 'กรุณากรอกเลขโต๊ะเป็นจำนวนเต็มมากกว่า 0';
    }
    if (form.adultCount === '' || !Number.isInteger(adultCount) || adultCount < 0) {
      return 'กรุณากรอกจำนวนผู้ใหญ่เป็นจำนวนเต็มไม่ติดลบ';
    }
    if (form.childCount === '' || !Number.isInteger(childCount) || childCount < 0) {
      return 'กรุณากรอกจำนวนเด็กเป็นจำนวนเต็มไม่ติดลบ';
    }
    if (adultCount + childCount <= 0) {
      return 'ต้องมีลูกค้าอย่างน้อย 1 คน';
    }
    return '';
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setErrorMessage('');

    const validationError = validate();
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }

    const tableNumber = Number(form.tableNumber);
    const adultCount = Number(form.adultCount);
    const childCount = Number(form.childCount);

    setSubmitting(true);
    try {
      // 1. เช็คว่าโต๊ะนี้มี session ที่ status = 'open' อยู่แล้วหรือไม่
      const { data: existing, error: checkError } = await supabase
        .from('sessions')
        .select('id, table_number, adult_count, child_count, created_at')
        .eq('table_number', tableNumber)
        .eq('status', 'open')
        .limit(1);

      if (checkError) throw checkError;

      if (existing && existing.length > 0) {
        setOpenSession(existing[0]);
        setSubmitting(false);
        return;
      }

      // 2. ไม่มี session เปิดค้าง -> สร้างใหม่
      const { data: inserted, error: insertError } = await supabase
        .from('sessions')
        .insert({
          table_number: tableNumber,
          adult_count: adultCount,
          child_count: childCount,
          status: 'open',
        })
        .select()
        .single();

      if (insertError) throw insertError;

      const orderUrl = `${window.location.origin}/order/${inserted.table_number}`;
      setResult({
        tableNumber: inserted.table_number,
        adultCount: inserted.adult_count,
        childCount: inserted.child_count,
        url: orderUrl,
      });
      setOpenSession(null);
    } catch (err) {
      setErrorMessage(err.message || 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง');
    } finally {
      setSubmitting(false);
    }
  }

  function openConfirmDialog() {
    setConfirmError('');
    setShowConfirm(true);
  }

  function cancelConfirmDialog() {
    setShowConfirm(false);
    setConfirmError('');
  }

  async function handleConfirmClose() {
    if (!openSession) return;
    setClosingSession(true);
    setConfirmError('');
    try {
      // เช็คซ้ำว่า status ยังเป็น 'open' อยู่ตอน update เพื่อกันกดซ้ำซ้อน
      const { data, error } = await supabase
        .from('sessions')
        .update({ status: 'closed' })
        .eq('id', openSession.id)
        .eq('status', 'open')
        .select();

      if (error) throw error;

      if (!data || data.length === 0) {
        setConfirmError('โต๊ะนี้ถูกปิดไปแล้วโดยผู้อื่น กรุณาลองเปิดโต๊ะใหม่อีกครั้ง');
        setClosingSession(false);
        return;
      }

      setShowConfirm(false);
      setOpenSession(null);
    } catch (err) {
      setConfirmError(err.message || 'ปิดโต๊ะเดิมไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      setClosingSession(false);
    }
  }

  async function handleCopyLink() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  function handleNewTable() {
    setResult(null);
    setForm(emptyForm());
    setErrorMessage('');
  }

  // --- หน้าจอผลลัพธ์ QR ---
  if (result) {
    const qrSrc = `${QR_ENDPOINT}${encodeURIComponent(result.url)}`;
    return (
      <main className={styles.page}>
        <header className={styles.header}>
          <h1 className={styles.shopName}>สุกี้ผีน้อย</h1>
          <p className={styles.subtitle}>เปิดโต๊ะให้ลูกค้า</p>
        </header>

        <div className={styles.resultCard}>
          <p className={styles.resultTitle}>เปิดโต๊ะสำเร็จ</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={styles.qrImage} src={qrSrc} alt={`QR โต๊ะ ${result.tableNumber}`} />
          <p className={styles.summaryText}>
            โต๊ะ {result.tableNumber} · ผู้ใหญ่ {result.adultCount} · เด็ก {result.childCount}
          </p>
          <div className={styles.linkRow}>
            <span className={styles.linkText}>{result.url}</span>
            <button type="button" className={styles.copyButton} onClick={handleCopyLink}>
              {copied ? 'คัดลอกแล้ว' : 'คัดลอกลิงก์'}
            </button>
          </div>
          <button type="button" className={styles.newTableButton} onClick={handleNewTable}>
            เปิดโต๊ะใหม่
          </button>
        </div>
      </main>
    );
  }

  // --- หน้าจอฟอร์มหลัก (+ กล่องเตือน / กล่องยืนยัน) ---
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.shopName}>สุกี้ผีน้อย</h1>
        <p className={styles.subtitle}>เปิดโต๊ะให้ลูกค้า</p>
      </header>

      <form className={styles.card} onSubmit={handleSubmit}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="tableNumber">
            เลขโต๊ะ
          </label>
          <input
            id="tableNumber"
            className={styles.input}
            type="number"
            inputMode="numeric"
            min="1"
            value={form.tableNumber}
            onChange={(e) => handleChange('tableNumber', e.target.value)}
            placeholder="เช่น 7"
          />
        </div>

        <div className={styles.row}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="adultCount">
              ผู้ใหญ่
            </label>
            <input
              id="adultCount"
              className={styles.input}
              type="number"
              inputMode="numeric"
              min="0"
              value={form.adultCount}
              onChange={(e) => handleChange('adultCount', e.target.value)}
              placeholder="0"
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="childCount">
              เด็ก
            </label>
            <input
              id="childCount"
              className={styles.input}
              type="number"
              inputMode="numeric"
              min="0"
              value={form.childCount}
              onChange={(e) => handleChange('childCount', e.target.value)}
              placeholder="0"
            />
          </div>
        </div>

        <button type="submit" className={styles.submitButton} disabled={submitting}>
          {submitting ? 'กำลังตรวจสอบ...' : 'เปิดโต๊ะ'}
        </button>

        {errorMessage && <p className={styles.errorText}>{errorMessage}</p>}
      </form>

      {openSession && (
        <div className={styles.warningBox}>
          <p className={styles.warningTitle}>
            โต๊ะนี้มีลูกค้าอยู่ระหว่างทานอาหาร กรุณาปิดออเดอร์เดิมก่อน
          </p>
          <button
            type="button"
            className={styles.warningButton}
            onClick={openConfirmDialog}
            disabled={closingSession}
          >
            ปิดออเดอร์เดิม
          </button>
        </div>
      )}

      {showConfirm && openSession && (
        <div className={styles.overlay}>
          <div className={styles.modal}>
            <p className={styles.modalTitle}>ยืนยันปิดโต๊ะเดิม</p>
            <p className={styles.modalDetail}>
              โต๊ะ <strong>{openSession.table_number}</strong>
              <br />
              ผู้ใหญ่ <strong>{openSession.adult_count}</strong> · เด็ก{' '}
              <strong>{openSession.child_count}</strong>
              <br />
              เปิดมาแล้ว <strong>{elapsedMinutes} นาที</strong>
            </p>
            {confirmError && <p className={styles.errorText}>{confirmError}</p>}
            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.cancelButton}
                onClick={cancelConfirmDialog}
                disabled={closingSession}
              >
                ยกเลิก
              </button>
              <button
                type="button"
                className={styles.confirmButton}
                onClick={handleConfirmClose}
                disabled={closingSession}
              >
                {closingSession ? 'กำลังปิด...' : 'ยืนยันปิดโต๊ะเดิม'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
