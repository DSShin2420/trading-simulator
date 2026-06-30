import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';

// ---------- 기본 데이터: GitHub Pages에서 자동 로드 ----------
const AUTO_LOAD_ZIP_URL = 'https://dsshin2420.github.io/trading-simulator/KOSDAQ_Kospi_50.zip';
const CACHE_KEY = 'trading_sim_github_zip_v1';

const getStorageApi = () => {
  if (typeof window === 'undefined') return null;
  if (window.storage && typeof window.storage.get === 'function') return window.storage;
  if (typeof localStorage !== 'undefined') {
    return {
      get: async (key) => { const v = localStorage.getItem(key); return v === null ? null : { value: v }; },
      set: async (key, value) => { localStorage.setItem(key, value); },
      delete: async (key) => { localStorage.removeItem(key); },
    };
  }
  return null;
};

import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, ReferenceDot, ReferenceLine
} from 'recharts';
import { ChevronRight, RotateCcw, Download, X, Clock, ZoomIn, ZoomOut, Maximize2, Upload } from 'lucide-react';

function generateData(days) {
  const data = [];
  let price = 50000;
  const date = new Date(2024, 0, 2);
  for (let i = 0; i < days; i++) {
    const changePercent = (Math.random() - 0.5) * 0.04 + 0.0008;
    const open = price;
    const close = Math.max(100, open * (1 + changePercent));
    const high = Math.max(open, close) * (1 + Math.random() * 0.015);
    const low = Math.min(open, close) * (1 - Math.random() * 0.015);
    const volume = Math.floor(Math.random() * 900000 + 100000);
    data.push({ idx: i, date: date.toISOString().slice(0, 10), open: Math.round(open), high: Math.round(high), low: Math.round(low), close: Math.round(close), volume, range: [Math.round(low), Math.round(high)] });
    price = close;
    date.setDate(date.getDate() + 1);
    while (date.getDay() === 0 || date.getDay() === 6) date.setDate(date.getDate() + 1);
  }
  for (let i = 0; i < data.length; i++) {
    const s = (n) => { let t = 0; for (let k = 0; k < n; k++) t += data[i - k].close; return Math.round(t / n); };
    if (i >= 4) data[i].ma5 = s(5);
    if (i >= 19) data[i].ma20 = s(20);
    if (i >= 59) data[i].ma60 = s(60);
    if (i >= 119) data[i].ma120 = s(120);
  }
  return data;
}

const fmt = (n) => Math.round(n).toLocaleString('ko-KR');

const calendarDaysBetween = (a, b) => {
  return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
};

function niceStep(range, targetTicks = 6) {
  if (!range || range <= 0) return 1;
  const rough = range / targetTicks;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  return (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
}

function parseCustomData(text) {
  const lines = text.trim().split(/\r?\n/).filter(l => l.trim().length > 0);
  if (!lines.length) return null;
  let rows = lines.map(l => {
    let cols = l.includes('\t') ? l.split('\t') : l.includes(',') ? l.split(',') : l.trim().split(/\s+/);
    return cols.map(c => c.trim());
  });
  if (!/^\d{4}[-./]\d{1,2}[-./]\d{1,2}/.test(rows[0][0])) rows = rows.slice(1);
  const num = v => { if (v === undefined || v === '') return undefined; const n = Number(String(v).replace(/,/g, '')); return isNaN(n) ? undefined : n; };
  const data = rows.map(cols => {
    const [date, open, high, low, close, ma5, ma20, ma60, ma120, volume] = cols;
    const o = num(open), h = num(high), l = num(low), c = num(close);
    if ([o, h, l, c].some(v => v === undefined)) return null;
    return { date: (date || '').replace(/[./]/g, '-'), open: o, high: h, low: l, close: c, ma5: num(ma5), ma20: num(ma20), ma60: num(ma60), ma120: num(ma120), volume: num(volume) ?? 0, range: [l, h] };
  }).filter(Boolean);
  if (!data.length) return null;
  data.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  data.forEach((d, i) => { d.idx = i; });
  return data;
}

function listZipEntries(buffer) {
  const view = new DataView(buffer), bytes = new Uint8Array(buffer);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) { if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; } }
  if (eocd < 0) throw new Error('ZIP 형식 오류');
  const entryCount = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const entries = [];
  for (let i = 0; i < entryCount; i++) {
    if (view.getUint32(offset, true) !== 0x02014b50) break;
    const compMethod = view.getUint16(offset + 10, true), compSize = view.getUint32(offset + 20, true), uncompSize = view.getUint32(offset + 24, true);
    const nameLen = view.getUint16(offset + 28, true), extraLen = view.getUint16(offset + 30, true), commentLen = view.getUint16(offset + 32, true);
    const lfhOffset = view.getUint32(offset + 42, true);
    const name = new TextDecoder('utf-8').decode(bytes.slice(offset + 46, offset + 46 + nameLen));
    entries.push({ name, compMethod, compSize, uncompSize, lfhOffset });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function getZipEntryText(buffer, entry) {
  const view = new DataView(buffer), bytes = new Uint8Array(buffer);
  const lfh = entry.lfhOffset, nameLen = view.getUint16(lfh + 26, true), extraLen = view.getUint16(lfh + 28, true);
  const compData = bytes.slice(lfh + 30 + nameLen + extraLen, lfh + 30 + nameLen + extraLen + entry.compSize);
  let outBytes;
  if (entry.compMethod === 0) { outBytes = compData; }
  else if (entry.compMethod === 8) {
    if (typeof DecompressionStream === 'undefined') throw new Error('ZIP 압축 해제 미지원');
    const ds = new DecompressionStream('deflate-raw');
    outBytes = new Uint8Array(await new Response(new Blob([compData]).stream().pipeThrough(ds)).arrayBuffer());
  } else throw new Error(`미지원 압축 방식 ${entry.compMethod}`);
  return new TextDecoder('utf-8').decode(outBytes);
}

const randomStart = (len) => {
  const minStart = Math.min(20, Math.max(0, len - 1));
  const maxStart = Math.max(minStart, len - 1 - 150);
  return minStart + Math.floor(Math.random() * (maxStart - minStart + 1));
};

// ---------- 캔들 컴포넌트 ----------
const Candle = ({ x, y, width, height, payload }) => {
  if (!payload || payload.high === payload.low) return null;
  const isUp = payload.close >= payload.open;
  const color = isUp ? '#dc2626' : '#2563eb';
  const scale = v => y + ((payload.high - v) / (payload.high - payload.low)) * height;
  const openY = scale(payload.open), closeY = scale(payload.close);
  const bodyTop = Math.min(openY, closeY), bodyH = Math.max(Math.abs(closeY - openY), 1);
  const cx = x + width / 2, bodyW = Math.max(width * 0.6, 2);
  return <g><line x1={cx} y1={y} x2={cx} y2={y + height} stroke={color} strokeWidth={1} /><rect x={cx - bodyW / 2} y={bodyTop} width={bodyW} height={bodyH} fill={color} /></g>;
};

const VolumeBar = ({ x, y, width, height, payload }) => (
  <rect x={x} y={y} width={width} height={height} fill={payload && payload.close >= payload.open ? '#dc262644' : '#2563eb44'} />
);

const ChartTooltip = ({ active, payload }) => {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, padding: '8px 12px', fontSize: 12, fontFamily: 'monospace', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
      <div style={{ color: '#64748b', marginBottom: 4 }}>{d.date}</div>
      <div style={{ color: '#1e293b' }}>시 {fmt(d.open)} · 고 {fmt(d.high)}</div>
      <div style={{ color: '#1e293b' }}>저 {fmt(d.low)} · 종 {fmt(d.close)}</div>
      <div style={{ color: '#94a3b8' }}>거래량 {fmt(d.volume)}</div>
    </div>
  );
};

// ---------- Y축 드래그 확대/축소 핸들러 ----------
// Y축 영역을 700ms 이상 꾹 누른 상태에서 위/아래로 드래그하면 줌이 변경됩니다.
function useYAxisZoom(zoomDays, setZoomDays, allDataLength) {
  const pressTimer = useRef(null);
  const isDraggingRef = useRef(false);
  const startY = useRef(0);
  const startZoom = useRef(zoomDays);
  const [isActive, setIsActive] = useState(false); // 드래그 모드 진입 여부 (시각 피드백용)

  const clearPressTimer = () => { if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null; } };

  const onPointerDown = useCallback((e) => {
    // 텍스트 선택/스크롤 등 브라우저 기본 동작을 즉시 차단 (지연 없이 바로 막아야 함)
    e.preventDefault();
    if (e.stopPropagation) e.stopPropagation();
    const clientY = e.clientY ?? (e.touches && e.touches[0] ? e.touches[0].clientY : 0);
    startY.current = clientY;
    startZoom.current = zoomDays;
    isDraggingRef.current = false;
    clearPressTimer();
    pressTimer.current = setTimeout(() => {
      isDraggingRef.current = true;
      setIsActive(true);
      if (typeof document !== 'undefined') {
        document.body.style.userSelect = 'none';
        document.body.style.webkitUserSelect = 'none';
      }
    }, 700);
  }, [zoomDays]);

  const onPointerMove = useCallback((e) => {
    if (!isDraggingRef.current) return;
    e.preventDefault();
    const clientY = e.clientY ?? (e.touches && e.touches[0] ? e.touches[0].clientY : startY.current);
    const dy = startY.current - clientY; // 위로 드래그 → 양수 → 확대(더 많은 일수 표시)
    const factor = dy / 2; // 픽셀당 1/2일 변화
    const newZoom = Math.min(allDataLength, Math.max(10, Math.round(startZoom.current - factor)));
    setZoomDays(newZoom);
  }, [allDataLength, setZoomDays]);

  const onPointerUp = useCallback(() => {
    clearPressTimer();
    isDraggingRef.current = false;
    setIsActive(false);
    if (typeof document !== 'undefined') {
      document.body.style.userSelect = '';
      document.body.style.webkitUserSelect = '';
    }
  }, []);

  useEffect(() => {
    return () => {
      clearPressTimer();
      if (typeof document !== 'undefined') { document.body.style.userSelect = ''; document.body.style.webkitUserSelect = ''; }
    };
  }, []);

  return { onPointerDown, onPointerMove, onPointerUp, isActive };
}

const START_CASH = 10_000_000;

export default function TradingSimulator() {
  const [isLoading, setIsLoading] = useState(true);
  const [loadStatus, setLoadStatus] = useState('데이터 불러오는 중...');
  const [githubDatasets, setGithubDatasets] = useState([]);
  const [allData, setAllData] = useState(() => generateData(300));
  const [dataSource, setDataSource] = useState('랜덤 데이터');
  const [csvText, setCsvText] = useState('');
  const [customDatasets, setCustomDatasets] = useState([]);
  const [showDataPanel, setShowDataPanel] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(() => randomStart(300));
  const [cash, setCash] = useState(START_CASH);
  const [shares, setShares] = useState(0);
  const [avgCost, setAvgCost] = useState(0);
  const [toppedUp, setToppedUp] = useState(0);
  const [chartStartValue, setChartStartValue] = useState(START_CASH);
  const [chartToppedUp, setChartToppedUp] = useState(0);
  const [pendingOrders, setPendingOrders] = useState([]);
  const [tradeLog, setTradeLog] = useState([]);
  const [positionOpenIdx, setPositionOpenIdx] = useState(null);
  const [gameHeldDays, setGameHeldDays] = useState(0);
  const [gameHeldCalendarDays, setGameHeldCalendarDays] = useState(0);
  const [chartHeldDays, setChartHeldDays] = useState(0);
  const [chartHeldCalendarDays, setChartHeldCalendarDays] = useState(0);
  const [qty, setQty] = useState(10);
  const [price, setPrice] = useState(0);
  const [showGridPanel, setShowGridPanel] = useState(false);
  const [gridSide, setGridSide] = useState('buy');
  const [gridBasePrice, setGridBasePrice] = useState(0);
  const [gridStep, setGridStep] = useState(500);
  const [gridQtyPerStep, setGridQtyPerStep] = useState(10);
  const [gridSteps, setGridSteps] = useState(10);
  const [zoomDays, setZoomDays] = useState(60);
  const [message, setMessage] = useState(null);
  const [exportCsv, setExportCsv] = useState(null);
  const [exportRange, setExportRange] = useState(null);
  const parseCacheRef = useRef(new Map());
  const exportTextareaRef = useRef(null);
  const yAxisZoom = useYAxisZoom(zoomDays, setZoomDays, allData.length);

  useEffect(() => {
    (async () => {
      const storage = getStorageApi();
      try {
        const cached = storage ? await storage.get(CACHE_KEY) : null;
        if (cached) {
          const payload = JSON.parse(cached.value);
          const datasets = payload.map((d, i) => ({ id: `gh:${i}:${d.name}`, name: d.name, kind: 'saved', data: d.rows.map((r, idx) => ({ idx, date: r[0], open: r[1], high: r[2], low: r[3], close: r[4], ma5: r[5] ?? undefined, ma20: r[6] ?? undefined, ma60: r[7] ?? undefined, ma120: r[8] ?? undefined, volume: r[9] ?? 0, range: [r[3], r[2]] })) }));
          setGithubDatasets(datasets);
          const pick = datasets[Math.floor(Math.random() * datasets.length)];
          const start = randomStart(pick.data.length);
          setAllData(pick.data); setDataSource(pick.name); setCurrentIndex(start); setPrice(pick.data[start].close);
          setIsLoading(false); return;
        }
      } catch (err) { console.warn('캐시 복원 실패:', err); }

      try {
        const candidateUrls = [AUTO_LOAD_ZIP_URL];
        if (typeof window !== 'undefined') {
          candidateUrls.push(new URL('./KOSDAQ_Kospi_50.zip', window.location.href).toString());
          candidateUrls.push('/KOSDAQ_Kospi_50.zip');
        }
        let loadedDatasets = null;
        for (const zipUrl of [...new Set(candidateUrls)]) {
          try {
            setLoadStatus(`ZIP 다운로드 중... (${zipUrl})`);
            const res = await fetch(zipUrl, { signal: AbortSignal.timeout(30000), cache: 'no-store' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const buffer = await res.arrayBuffer();
            const magic = new Uint8Array(buffer.slice(0, 4));
            if (!(magic[0] === 0x50 && magic[1] === 0x4B && magic[2] === 0x03 && magic[3] === 0x04)) throw new Error('유효한 ZIP 아님');
            setLoadStatus('CSV 파싱 중...');
            const datasets = [];
            for (const en of listZipEntries(buffer).filter(en => /\.(csv|txt)$/i.test(en.name) && en.uncompSize > 0 && !en.name.includes('__MACOSX') && !en.name.split('/').pop().startsWith('.'))) {
              try {
                const parsed = parseCustomData(await getZipEntryText(buffer, en));
                if (parsed && parsed.length >= 2) datasets.push({ id: `gh:${datasets.length}:${en.name}`, name: en.name, kind: 'saved', data: parsed });
              } catch {}
            }
            if (!datasets.length) throw new Error('CSV 없음');
            loadedDatasets = datasets; break;
          } catch (err) { console.warn(`ZIP 실패 (${zipUrl}):`, err); }
        }
        if (!loadedDatasets) throw new Error('ZIP 로드 실패');
        try {
          if (storage) await storage.set(CACHE_KEY, JSON.stringify(loadedDatasets.map(d => ({ name: d.name, rows: d.data.map(r => [r.date, r.open, r.high, r.low, r.close, r.ma5 ?? null, r.ma20 ?? null, r.ma60 ?? null, r.ma120 ?? null, r.volume]) }))));
        } catch (e) { console.warn('캐시 저장 실패:', e.message); }
        setGithubDatasets(loadedDatasets);
        const pick = loadedDatasets[Math.floor(Math.random() * loadedDatasets.length)];
        const start = randomStart(pick.data.length);
        setAllData(pick.data); setDataSource(pick.name); setCurrentIndex(start); setPrice(pick.data[start].close);
      } catch (err) {
        setLoadStatus(`로드 실패 (${err.message}) — 랜덤 데이터로 시작`);
        const d = generateData(300); const start = randomStart(d.length);
        setAllData(d); setDataSource('랜덤 데이터'); setCurrentIndex(start); setPrice(d[start].close);
      }
      setIsLoading(false);
    })();
  }, []);

  const today = allData[currentIndex];
  const visible = useMemo(() => allData.slice(0, currentIndex + 1), [allData, currentIndex]);
  const portfolioValue = cash + shares * today.close;
  const costBasis = avgCost * shares;
  const positionPnl = shares * today.close - costBasis;
  const positionReturnPct = costBasis > 0 ? (positionPnl / costBasis) * 100 : 0;
  const chartInvested = chartStartValue + chartToppedUp;
  const chartPnl = portfolioValue - chartInvested;
  const chartReturnPct = chartInvested > 0 ? (chartPnl / chartInvested) * 100 : 0;
  const gameInvested = START_CASH + toppedUp;
  const gamePnl = portfolioValue - gameInvested;
  const returnPct = gameInvested > 0 ? (gamePnl / gameInvested) * 100 : 0;

  const inProgressDays = positionOpenIdx !== null ? currentIndex - positionOpenIdx : 0;
  const inProgressCalendarDays = positionOpenIdx !== null ? calendarDaysBetween(allData[positionOpenIdx].date, today.date) : 0;
  const currentChartHeldDays = chartHeldDays + inProgressDays;
  const currentChartHeldCalendarDays = chartHeldCalendarDays + inProgressCalendarDays;
  const currentChartHeldYears = currentChartHeldCalendarDays / 365;
  const gameTotalHeldDays = gameHeldDays + inProgressDays;
  const gameTotalHeldCalendarDays = gameHeldCalendarDays + inProgressCalendarDays;
  const gameTotalHeldYears = gameTotalHeldCalendarDays / 365;

  const { yDomain, yTicks } = useMemo(() => {
    const vis = visible.slice(-zoomDays);
    const vals = [];
    vis.forEach(d => { vals.push(d.low, d.high); [d.ma5, d.ma20, d.ma60, d.ma120].forEach(v => { if (v !== undefined && !isNaN(v)) vals.push(v); }); });
    vals.push(today.close);
    const min = Math.min(...vals), max = Math.max(...vals);
    const pad = (max - min) * 0.05 || max * 0.02;
    const step = niceStep(max - min + pad * 2);
    const niceMin = Math.floor((min - pad) / step) * step;
    const niceMax = Math.ceil((max + pad) / step) * step;
    const ticks = [];
    for (let v = niceMin; v <= niceMax + step * 0.001; v += step) ticks.push(Math.round(v));
    return { yDomain: [niceMin, niceMax], yTicks: ticks };
  }, [visible, zoomDays, today]);

  const chartData = visible.slice(-zoomDays);
  const refPrice = Number(price) || today.close;
  const maxBuyQty = refPrice > 0 ? Math.floor(cash / refPrice) : 0;
  const maxSellQty = shares;

  const log = entry => setTradeLog(prev => [...prev, entry]);

  const trackPositionOnSharesChange = (prevShares, newShares, idxAtChange) => {
    if (prevShares === 0 && newShares > 0) { setPositionOpenIdx(idxAtChange); }
    else if (prevShares > 0 && newShares === 0) {
      setPositionOpenIdx(openIdx => {
        if (openIdx !== null) {
          const td = Math.max(0, idxAtChange - openIdx);
          const cd = Math.max(0, calendarDaysBetween(allData[openIdx].date, allData[idxAtChange].date));
          setGameHeldDays(d => d + td); setGameHeldCalendarDays(d => d + cd);
          setChartHeldDays(d => d + td); setChartHeldCalendarDays(d => d + cd);
        }
        return null;
      });
    }
  };

  const placeMarketOrder = (orderSide) => {
    const q = Number(qty); if (!q || q <= 0) { setMessage('수량을 입력해주세요.'); return; }
    setMessage(null); const p = today.close;
    if (orderSide === 'buy') {
      const cost = p * q; if (cost > cash) { setMessage(`현금 부족. 필요 ${fmt(cost)}원 / 잔고 ${fmt(cash)}원`); return; }
      const newShares = shares + q; setAvgCost((avgCost * shares + cost) / newShares); setShares(newShares); setCash(c => c - cost);
      trackPositionOnSharesChange(shares, newShares, currentIndex);
      log({ date: today.date, idx: currentIndex, action: 'BUY', orderType: '시장가', qty: q, price: p });
    } else {
      if (q > shares) { setMessage(`보유 수량(${shares}주)보다 많습니다.`); return; }
      const newShares = shares - q; setShares(newShares); if (newShares === 0) setAvgCost(0); setCash(c => c + p * q);
      trackPositionOnSharesChange(shares, newShares, currentIndex);
      log({ date: today.date, idx: currentIndex, action: 'SELL', orderType: '시장가', qty: q, price: p });
    }
  };

  const placeLimitOrder = (orderSide) => {
    const q = Number(qty); if (!q || q <= 0) { setMessage('수량을 입력해주세요.'); return; }
    const p = Number(price); if (!p || p <= 0) { setMessage('예약 가격을 입력해주세요.'); return; }
    setMessage(null);
    setPendingOrders(prev => [...prev, { id: `limit:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`, side: orderSide, qty: q, price: p, placedDate: today.date }]);
  };

  const placeGridOrders = (orderSide, basePrice, step, qtyPerStep, steps) => {
    const b = Number(basePrice), s = Number(step), q = Number(qtyPerStep), n = Number(steps);
    if (!b || b <= 0) { setMessage('기준 가격 입력'); return; }
    if (!s || s <= 0) { setMessage('가격 간격 입력'); return; }
    if (!q || q <= 0) { setMessage('단계별 수량 입력'); return; }
    if (!n || n <= 0) { setMessage('단계 수 입력'); return; }
    const existingSameSide = pendingOrders.filter(o => o.side === orderSide);
    let budgetRemaining = orderSide === 'buy' ? cash - existingSameSide.reduce((sum, o) => sum + o.price * o.qty, 0) : shares - existingSameSide.reduce((sum, o) => sum + o.qty, 0);
    const newOrders = []; let skipped = 0;
    for (let i = 0; i < n; i++) {
      const stepPrice = orderSide === 'buy' ? b - s * i : b + s * i;
      if (stepPrice <= 0) break;
      const stepCost = orderSide === 'buy' ? Math.round(stepPrice) * q : q;
      if (stepCost > budgetRemaining) { skipped++; continue; }
      budgetRemaining -= stepCost;
      newOrders.push({ id: `grid:${Date.now()}:${i}:${Math.random().toString(36).slice(2, 8)}`, side: orderSide, qty: q, price: Math.round(stepPrice), placedDate: today.date });
    }
    if (!newOrders.length) { setMessage('등록 가능한 예약 주문 없음'); return; }
    setPendingOrders(prev => [...prev, ...newOrders]);
    const msg = `(${fmt(newOrders[0].price)}원 ~ ${fmt(newOrders[newOrders.length - 1].price)}원)`;
    setMessage(`${orderSide === 'buy' ? '매수' : '매도'} 그리드 ${newOrders.length}건 등록 완료 ${msg}${skipped > 0 ? `. ${skipped}건 생략` : ''}`);
    setShowGridPanel(false);
  };

  const cancelOrder = (id) => {
    const o = pendingOrders.find(x => x.id === id);
    if (o) log({ date: today.date, idx: currentIndex, action: 'CANCEL', orderType: '예약', qty: o.qty, price: o.price });
    setPendingOrders(prev => prev.filter(x => x.id !== id));
  };

  const cancelAllOrders = (side) => {
    const toCancel = pendingOrders.filter(o => o.side === side);
    if (!toCancel.length) { setMessage(`취소할 ${side === 'buy' ? '매수' : '매도'} 예약 없음`); return; }
    toCancel.forEach(o => log({ date: today.date, idx: currentIndex, action: 'CANCEL', orderType: '예약(일괄취소)', qty: o.qty, price: o.price }));
    setPendingOrders(prev => prev.filter(o => o.side !== side));
    setMessage(`${side === 'buy' ? '매수' : '매도'} 예약 ${toCancel.length}건 취소`);
  };

  const computeNextDayState = (state) => {
    const { idx, cash: c, shares: sh, avgCost: avg, pendingOrders: pending } = state;
    if (idx + 1 >= allData.length) return null;
    const next = allData[idx + 1];
    let nextCash = c, nextShares = sh, nextAvg = avg;
    const remaining = [], newLogs = [];
    pending.forEach(order => {
      const filled = order.side === 'buy' ? next.low <= order.price : next.high >= order.price;
      if (filled) {
        if (order.side === 'buy') {
          const cost = order.price * order.qty;
          if (cost <= nextCash) { const ns = nextShares + order.qty; nextAvg = (nextAvg * nextShares + cost) / ns; nextShares = ns; nextCash -= cost; newLogs.push({ date: next.date, idx: idx + 1, action: 'BUY', orderType: '예약(체결)', qty: order.qty, price: order.price }); }
        } else {
          if (order.qty <= nextShares) { nextShares -= order.qty; nextCash += order.price * order.qty; if (nextShares === 0) nextAvg = 0; newLogs.push({ date: next.date, idx: idx + 1, action: 'SELL', orderType: '예약(체결)', qty: order.qty, price: order.price }); }
        }
      } else { remaining.push(order); }
    });
    return { idx: idx + 1, cash: nextCash, shares: nextShares, avgCost: nextAvg, pendingOrders: remaining, newLogs, prevShares: sh };
  };

  const advanceDays = (n) => {
    let state = { idx: currentIndex, cash, shares, avgCost, pendingOrders };
    const allNewLogs = []; let positionEvents = []; let stepsRun = 0;
    for (let i = 0; i < n; i++) {
      const result = computeNextDayState(state); if (!result) break;
      positionEvents.push({ prevShares: result.prevShares, newShares: result.shares, idx: result.idx });
      allNewLogs.push(...result.newLogs);
      state = { idx: result.idx, cash: result.cash, shares: result.shares, avgCost: result.avgCost, pendingOrders: result.pendingOrders };
      stepsRun++;
    }
    if (stepsRun === 0) { setMessage('더 이상 진행할 날짜가 없습니다.'); return; }
    setMessage(null); setCash(state.cash); setAvgCost(state.avgCost); setPendingOrders(state.pendingOrders);
    if (allNewLogs.length) setTradeLog(prev => [...prev, ...allNewLogs]);
    positionEvents.forEach(ev => trackPositionOnSharesChange(ev.prevShares, ev.newShares, ev.idx));
    setShares(state.shares); setPrice(allData[state.idx].close); setCurrentIndex(state.idx);
    if (stepsRun < n) setMessage(`마지막 날짜에 도달해 ${stepsRun}일만 진행했습니다.`);
  };

  const applyDataset = (data, name, keepAccount = false, chartStartSnapshot = START_CASH) => {
    const start = randomStart(data.length);
    setAllData(data); setDataSource(name); setCurrentIndex(start);
    if (!keepAccount) { setCash(START_CASH); setShares(0); setAvgCost(0); setToppedUp(0); setGameHeldDays(0); setGameHeldCalendarDays(0); }
    setPendingOrders([]); setTradeLog([]); setPositionOpenIdx(null);
    setChartHeldDays(0); setChartHeldCalendarDays(0);
    setChartStartValue(chartStartSnapshot); setChartToppedUp(0);
    setQty(10); setPrice(data[start].close); setMessage(null); setShowDataPanel(false);
  };

  const getParsedDataset = async (entry) => {
    if (parseCacheRef.current.has(entry.id)) return parseCacheRef.current.get(entry.id);
    const text = entry.kind === 'zip' ? await getZipEntryText(entry.buffer, entry.zipEntry) : entry.raw;
    const parsed = parseCustomData(text); if (parsed) parseCacheRef.current.set(entry.id, parsed);
    return parsed;
  };

  const useEntry = async (entry) => {
    setMessage('데이터 불러오는 중...');
    try {
      const parsed = await getParsedDataset(entry);
      if (!parsed || parsed.length < 2) { setMessage(`"${entry.name}" 데이터 확인 필요`); return; }
      applyDataset(parsed, entry.name);
    } catch (err) { setMessage(`불러오기 실패: ${err.message || err}`); }
  };

  const resetAll = () => {
    setMessage(null);
    const pool = [...githubDatasets, ...customDatasets];
    if (!pool.length) { applyDataset(generateData(300), '랜덤 데이터'); return; }
    const pick = pool[Math.floor(Math.random() * pool.length)];
    applyDataset(pick.data, pick.name);
  };

  const liquidateHoldings = () => {
    let finalCash = cash;
    if (shares > 0) {
      const proceeds = shares * today.close; finalCash = cash + proceeds; setCash(finalCash);
      setTradeLog(prev => [...prev, { date: today.date, idx: currentIndex, action: 'SELL', orderType: '차트 전환(전량 청산)', qty: shares, price: today.close }]);
      setShares(0); setAvgCost(0); trackPositionOnSharesChange(shares, 0, currentIndex);
    }
    setPendingOrders([]); return finalCash;
  };

  const refreshChartOnly = async () => {
    setMessage(null); const snapshot = liquidateHoldings();
    const pool = [...githubDatasets, ...customDatasets];
    if (!pool.length) { applyDataset(generateData(300), '랜덤 데이터', true, snapshot); return; }
    const pick = pool[Math.floor(Math.random() * pool.length)];
    try {
      const parsed = pick.data ? pick.data : await getParsedDataset(pick);
      if (!parsed || parsed.length < 2) { applyDataset(generateData(300), '랜덤 데이터', true, snapshot); return; }
      applyDataset(parsed, pick.name, true, snapshot);
    } catch { applyDataset(generateData(300), '랜덤 데이터', true, snapshot); }
  };

  const topUpCash = () => {
    setCash(c => c + START_CASH); setToppedUp(t => t + START_CASH); setChartToppedUp(t => t + START_CASH);
    setMessage(`현금 ${fmt(START_CASH)}원 충전`);
  };

  const applyCustomData = () => {
    const parsed = parseCustomData(csvText);
    if (!parsed || parsed.length < 2) { setMessage('데이터 형식 확인 필요'); return; }
    const entryName = `붙여넣은 데이터 ${customDatasets.length + 1}`;
    const id = `paste:${Date.now()}`; parseCacheRef.current.set(id, parsed);
    setCustomDatasets(prev => [...prev, { id, name: entryName, kind: 'text', raw: csvText }]);
    applyDataset(parsed, entryName);
  };

  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files || []); if (!files.length) return;
    setMessage('파일 확인 중...'); const newEntries = [];
    for (const file of files) {
      try {
        if (/\.zip$/i.test(file.name)) {
          const buffer = await file.arrayBuffer();
          listZipEntries(buffer).filter(en => /\.(csv|txt)$/i.test(en.name) && en.uncompSize > 0 && !en.name.includes('__MACOSX') && !en.name.split('/').pop().startsWith('.')).forEach(en => newEntries.push({ id: `zip:${file.name}::${en.name}`, name: `${file.name} / ${en.name}`, kind: 'zip', buffer, zipEntry: en }));
        } else { const text = await file.text(); newEntries.push({ id: `file:${file.name}:${file.size}`, name: file.name, kind: 'text', raw: text }); }
      } catch (err) { setMessage(`"${file.name}" 오류: ${err.message}`); }
    }
    if (!newEntries.length) { setMessage('CSV/TXT 파일을 찾지 못했습니다.'); e.target.value = ''; return; }
    setCustomDatasets(prev => [...prev, ...newEntries]);
    await useEntry(newEntries[Math.floor(Math.random() * newEntries.length)]);
    e.target.value = '';
  };

  const removeDataset = (i) => {
    setCustomDatasets(prev => { const removed = prev[i]; if (removed) parseCacheRef.current.delete(removed.id); return prev.filter((_, idx) => idx !== i); });
  };

  const exportTraining = () => {
    const validTrades = tradeLog.filter(t => t.action !== 'CANCEL');
    if (!validTrades.length) { setMessage('거래 내역 없음'); return; }
    const minIdx = Math.min(...validTrades.map(t => t.idx)), maxIdx = Math.max(...validTrades.map(t => t.idx));
    const byDate = {}; validTrades.forEach(t => { (byDate[t.date] = byDate[t.date] || []).push(t); });
    const header = ['date','open','high','low','close','volume','ma5','ma20','ma60','ma120','label','qty','order_price','order_type'];
    const rows = [header.join(',')];
    for (let i = minIdx; i <= maxIdx; i++) {
      const d = allData[i]; const ts = byDate[d.date];
      if (ts?.length) ts.forEach(t => rows.push([d.date,d.open,d.high,d.low,d.close,d.volume,d.ma5??'',d.ma20??'',d.ma60??'',d.ma120??'',t.action,t.qty,t.price,t.orderType].join(',')));
      else rows.push([d.date,d.open,d.high,d.low,d.close,d.volume,d.ma5??'',d.ma20??'',d.ma60??'',d.ma120??'','HOLD',0,'',''].join(','));
    }
    setExportCsv(rows.join('\n')); setExportRange({ from: allData[minIdx].date, to: allData[maxIdx].date, count: maxIdx - minIdx + 1 });
  };

  const downloadExportCsv = () => {
    if (!exportCsv) return;
    try {
      const url = URL.createObjectURL(new Blob([exportCsv], { type: 'text/csv;charset=utf-8;' }));
      const a = document.createElement('a'); a.href = url;
      a.download = `training_${exportRange?.from}_to_${exportRange?.to}_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setMessage('다운로드 실패. 직접 복사해주세요.'); }
  };

  const copyExportCsv = async () => {
    if (!exportCsv) return;
    try { await navigator.clipboard.writeText(exportCsv); setMessage('클립보드에 복사했습니다.'); return; } catch {}
    try { const ta = exportTextareaRef.current; if (ta) { ta.focus(); ta.select(); if (document.execCommand('copy')) { setMessage('클립보드에 복사했습니다.'); return; } } } catch {}
    setMessage('자동 복사 실패. Ctrl+C로 복사해주세요.');
    exportTextareaRef.current?.focus(); exportTextareaRef.current?.select();
  };

  const visibleTrades = useMemo(() => tradeLog.filter(t => t.idx >= (chartData[0]?.idx ?? 0) && t.action !== 'CANCEL'), [tradeLog, chartData]);

  // ── 스타일 상수 (라이트 테마) ──
  const s = {
    bg: 'bg-white', border: 'border-gray-200', card: 'bg-gray-50 border border-gray-200 rounded-lg p-3',
    text: 'text-gray-900', muted: 'text-gray-500', label: 'text-gray-600',
    input: 'bg-white border border-gray-300 rounded px-2 py-1.5 text-sm font-mono outline-none focus:border-blue-400',
    btn: 'text-xs px-3 py-2 rounded border border-gray-300 text-gray-600 hover:text-gray-900 hover:border-gray-400 transition-colors',
    btnBuy: 'flex items-center justify-center gap-1 bg-red-50 border border-red-400 text-red-600 rounded py-2.5 text-sm font-semibold hover:bg-red-100 transition-colors',
    btnSell: 'flex items-center justify-center gap-1 bg-blue-50 border border-blue-400 text-blue-600 rounded py-2.5 text-sm font-semibold hover:bg-blue-100 transition-colors',
    btnNext: 'flex items-center justify-center gap-1 bg-emerald-50 border border-emerald-400 text-emerald-700 rounded py-2.5 text-sm font-semibold hover:bg-emerald-100 transition-colors disabled:opacity-40',
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center gap-3">
        <div className="w-8 h-8 border-2 border-gray-300 border-t-emerald-500 rounded-full animate-spin"></div>
        <p className="text-gray-500 text-sm">{loadStatus}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-gray-900 font-sans p-4 md:p-6">
      <div className="max-w-6xl mx-auto">

        {/* 헤더 */}
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div>
            <h1 className="text-lg md:text-xl font-bold tracking-tight text-gray-900">매매 연습 시뮬레이터</h1>
            <p className="text-xs text-gray-500 font-mono mt-0.5">DAY {currentIndex + 1} / {allData.length} · {today.date}</p>
            <p className="text-[11px] text-gray-500 mt-0.5">데이터: <span className="text-gray-800 font-medium">{dataSource}</span></p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => setShowDataPanel(v => !v)} className={s.btn}>데이터 입력</button>
            <button onClick={topUpCash} className="flex items-center gap-1 text-xs px-3 py-2 rounded border border-amber-400 text-amber-600 hover:bg-amber-50 transition-colors">💰 금액 충전</button>
            <button onClick={resetAll} className="flex items-center gap-1 text-xs px-3 py-2 rounded border border-gray-300 text-gray-600 hover:text-gray-900 hover:border-gray-400 transition-colors"><RotateCcw size={14} /> 초기화</button>
            <button onClick={exportTraining} className="flex items-center gap-1 text-xs px-3 py-2 rounded bg-emerald-50 border border-emerald-400 text-emerald-700 hover:bg-emerald-100 transition-colors"><Download size={14} /> 학습 데이터 내보내기</button>
          </div>
        </div>

        {/* 데이터 입력 패널 */}
        {showDataPanel && (
          <div className="bg-gray-50 rounded-lg border border-gray-200 p-3 mb-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold text-gray-600">데이터 불러오기</h2>
              <span className="text-[10px] text-gray-400">현재: {dataSource} ({allData.length}일)</span>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[11px] text-gray-700 font-semibold">📦 기본 데이터 ({githubDatasets.length}종목)</p>
                <div className="flex gap-2">
                  <button onClick={() => { if (!githubDatasets.length) return; const pick = githubDatasets[Math.floor(Math.random() * githubDatasets.length)]; applyDataset(pick.data, pick.name); setShowDataPanel(false); }} className="text-[10px] px-2 py-0.5 rounded border border-emerald-400 text-emerald-600 hover:bg-emerald-50 transition-colors">🎲 랜덤 선택</button>
                  <button onClick={async () => { try { const storage = getStorageApi(); if (storage) await storage.delete(CACHE_KEY); } catch {} setMessage('캐시 삭제됨. 새로고침하면 최신 데이터를 받습니다.'); setShowDataPanel(false); }} className="text-[10px] px-2 py-0.5 rounded border border-gray-300 text-gray-500 hover:text-gray-700 hover:border-gray-400 transition-colors">🔄 캐시 새로고침</button>
                </div>
              </div>
              {githubDatasets.length > 0 ? (
                <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                  {githubDatasets.map(d => (
                    <button key={d.id} onClick={() => { applyDataset(d.data, d.name); setShowDataPanel(false); }}
                      className={`text-[11px] px-2 py-1 rounded border ${dataSource === d.name ? 'border-emerald-500 text-emerald-700 bg-emerald-50' : 'border-gray-300 text-gray-600'} hover:border-gray-400 hover:text-gray-900 transition-colors`}>
                      {d.name.replace('_KS_history.csv','').replace('_KQ_history.csv','')}
                    </button>
                  ))}
                </div>
              ) : <p className="text-[10px] text-amber-600">GitHub 데이터 로드 실패. 새로고침하거나 직접 파일을 올려주세요.</p>}
              <p className="text-[10px] text-gray-400">{AUTO_LOAD_ZIP_URL}</p>
            </div>
            <div className="border border-dashed border-gray-300 rounded-lg p-4 text-center">
              <label className="inline-flex items-center gap-2 text-sm px-4 py-2 rounded bg-emerald-50 border border-emerald-400 text-emerald-700 hover:bg-emerald-100 transition-colors cursor-pointer">
                <Upload size={14} /> .csv / .txt / .zip 파일 업로드
                <input type="file" accept=".csv,.txt,.zip" multiple onChange={handleFileUpload} className="hidden" />
              </label>
              <p className="text-[10px] text-gray-400 mt-2">형식: 날짜,시가,고가,저가,종가,MA5,MA20,MA60,MA120,거래량</p>
            </div>
            {customDatasets.length > 0 && (
              <div>
                <p className="text-[11px] text-gray-500 mb-1">등록된 데이터 ({customDatasets.length}개)</p>
                <div className="space-y-1">
                  {customDatasets.map((d, i) => (
                    <div key={d.id} className="flex items-center justify-between bg-white rounded px-2 py-1.5 text-xs border border-gray-200">
                      <span className="text-gray-700 truncate mr-2">{d.name}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        <button onClick={() => useEntry(d)} className="text-emerald-600 hover:text-emerald-800">사용</button>
                        <button onClick={() => removeDataset(i)} className="text-gray-400 hover:text-red-500"><X size={13} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <details className="text-xs">
              <summary className="cursor-pointer text-gray-500 hover:text-gray-700">직접 텍스트로 붙여넣기</summary>
              <div className="mt-2 space-y-2">
                <textarea value={csvText} onChange={e => setCsvText(e.target.value)} placeholder={'2024-01-02,50000,50500,49800,50200,,,,,123456\n...'} className="w-full h-28 bg-white border border-gray-300 rounded px-2 py-2 text-xs font-mono outline-none focus:border-blue-400 resize-y" />
                <button onClick={applyCustomData} className="text-xs px-3 py-1.5 rounded bg-emerald-50 border border-emerald-400 text-emerald-700 hover:bg-emerald-100 transition-colors">이 데이터로 시작</button>
              </div>
            </details>
            <button onClick={() => { applyDataset(generateData(300), '랜덤 데이터'); }} className="text-xs px-3 py-1.5 rounded border border-gray-300 text-gray-500 hover:text-gray-700 hover:border-gray-400 transition-colors">랜덤 데이터로 시작</button>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4">
          {/* 좌측 */}
          <div className="space-y-2">
            <div className="bg-white rounded-lg border border-gray-200 p-3">
              {/* 줌 컨트롤 */}
              <div className="flex items-center justify-between mb-2 flex-wrap gap-1">
                <span className="text-[11px] text-gray-500 font-mono">표시: {Math.min(zoomDays, visible.length)}일 · 차트 우측 Y축 영역을 0.7초 꾹 누른 뒤 위/아래로 드래그하면 확대/축소</span>
                <div className="flex items-center gap-1 flex-wrap">
                  <button onClick={refreshChartOnly} title="보유 주식 전량 매도 후 차트만 새로고침" className="flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-gray-300 text-gray-600 hover:text-gray-900 hover:border-gray-400 transition-colors"><ZoomIn size={12} /> 새로고침</button>
                  <button onClick={() => setZoomDays(z => Math.max(10, z - 10))} className="p-1.5 rounded border border-gray-300 text-gray-500 hover:text-gray-900 transition-colors"><ZoomOut size={13} /></button>
                  <button onClick={() => setZoomDays(z => Math.min(allData.length, z + 10))} className="p-1.5 rounded border border-gray-300 text-gray-500 hover:text-gray-900 transition-colors"><ZoomIn size={13} /></button>
                  {[60, 120, 250, 500].map(n => (
                    <button key={n} onClick={() => setZoomDays(n)} className={`text-[11px] px-2 py-1 rounded border ${zoomDays === n ? 'border-gray-700 text-gray-900 bg-gray-100' : 'border-gray-300 text-gray-500'} hover:text-gray-900 hover:border-gray-400 transition-colors`}>{n}일</button>
                  ))}
                  <button onClick={() => setZoomDays(allData.length)} className={`text-[11px] px-2 py-1 rounded border flex items-center gap-1 ${zoomDays >= allData.length ? 'border-gray-700 text-gray-900 bg-gray-100' : 'border-gray-300 text-gray-500'} hover:text-gray-900 hover:border-gray-400 transition-colors`}><Maximize2 size={11} /> 전체</button>
                </div>
              </div>

              {/* 캔들 차트 — 높이 242px (220의 10% 증가) */}
              <div style={{ position: 'relative' }}>
                <ResponsiveContainer width="100%" height={242}>
                  <ComposedChart data={chartData} margin={{ top: 5, right: 70, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="#f1f5f9" strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={d => d.slice(5)} minTickGap={20} />
                    <YAxis
                      domain={yDomain} ticks={yTicks}
                      tick={{ fontSize: 10, fill: yAxisZoom.isActive ? '#2563eb' : '#94a3b8' }}
                      tickFormatter={v => v.toLocaleString()} width={62}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="range" shape={<Candle />} isAnimationActive={false} />
                    <Line type="monotone" dataKey="ma5" stroke="#d97706" dot={false} strokeWidth={1.2} isAnimationActive={false} connectNulls />
                    <Line type="monotone" dataKey="ma20" stroke="#7c3aed" dot={false} strokeWidth={1.2} isAnimationActive={false} connectNulls />
                    <Line type="monotone" dataKey="ma60" stroke="#059669" dot={false} strokeWidth={1.2} isAnimationActive={false} connectNulls />
                    <Line type="monotone" dataKey="ma120" stroke="#db2777" dot={false} strokeWidth={1.2} isAnimationActive={false} connectNulls />
                    <ReferenceLine y={today.close} stroke="#94a3b8" strokeDasharray="4 4" strokeWidth={1}
                      label={(props) => {
                        const { viewBox } = props;
                        const text = fmt(today.close);
                        const w = text.length * 8 + 12;
                        const x = viewBox.x + viewBox.width + 2;
                        const y = viewBox.y;
                        return <text x={x + w / 2} y={y + 4} textAnchor="middle" fontSize={13} fontWeight={700} fill="#1e293b" stroke="#ffffff" strokeWidth={3} paintOrder="stroke">{text}</text>;
                      }} />
                    {visibleTrades.map((t, i) => {
                      const isBuy = t.action === 'BUY'; const color = isBuy ? '#dc2626' : '#2563eb';
                      return <ReferenceDot key={i} x={t.date} y={t.price} r={5} fill={color} stroke="#fff" strokeWidth={1.5} isFront
                        label={(props) => {
                          const { viewBox } = props;
                          return <text x={viewBox.x} y={viewBox.y + (isBuy ? 16 : -10)} textAnchor="middle" fontSize={10} fontFamily="monospace" fill={color}>{isBuy ? '매수' : '매도'} {t.qty}@{fmt(t.price)}</text>;
                        }} />;
                    })}
                  </ComposedChart>
                </ResponsiveContainer>

                {/* Y축 드래그 줌 오버레이: Y축 눈금이 그려지는 우측 영역(margin.right=70, axis.width=62)에
                    투명 레이어를 얹어 press&drag 제스처를 안정적으로 캡쳐합니다.
                    (recharts YAxis 컴포넌트에 직접 이벤트를 걸면 SVG 텍스트 선택과 충돌해 드래그가 안 먹는 문제가 있어 오버레이 방식으로 해결) */}
                <div
                  onMouseDown={yAxisZoom.onPointerDown}
                  onMouseMove={yAxisZoom.onPointerMove}
                  onMouseUp={yAxisZoom.onPointerUp}
                  onMouseLeave={yAxisZoom.onPointerUp}
                  onTouchStart={yAxisZoom.onPointerDown}
                  onTouchMove={yAxisZoom.onPointerMove}
                  onTouchEnd={yAxisZoom.onPointerUp}
                  style={{
                    position: 'absolute', top: 0, right: 0, bottom: 24, width: 70,
                    cursor: 'ns-resize', userSelect: 'none', WebkitUserSelect: 'none', touchAction: 'none',
                    background: yAxisZoom.isActive ? 'rgba(37,99,235,0.06)' : 'transparent',
                    borderLeft: yAxisZoom.isActive ? '1px dashed #2563eb' : '1px solid transparent',
                    transition: 'background 0.15s',
                  }}
                  title="꾹 눌러서(0.7초) 위/아래로 드래그하면 확대/축소됩니다"
                />
              </div>

              {/* 범례 */}
              <div className="flex gap-4 text-[10px] text-gray-500 px-2 mt-1 flex-wrap">
                {[['bg-amber-500','MA5'],['bg-violet-600','MA20'],['bg-emerald-600','MA60'],['bg-pink-600','MA120'],['bg-red-600','매수'],['bg-blue-600','매도']].map(([cls, label]) => (
                  <span key={label} className="flex items-center gap-1"><span className={`w-2 h-2 ${cls} inline-block rounded-full`}></span>{label}</span>
                ))}
              </div>

              {/* 시장가 매수/매도/다음날 버튼 — 아이콘 제거, 다음날 텍스트 제거 */}
              <div className="flex flex-wrap items-center gap-1.5 mt-3">
                <button onClick={() => placeMarketOrder('buy')} className="min-w-[80px] flex items-center justify-center bg-red-50 border border-red-400 text-red-600 rounded py-2 text-[13px] font-semibold hover:bg-red-100 transition-colors">
                  매수
                </button>
                <button onClick={() => placeMarketOrder('sell')} className="min-w-[80px] flex items-center justify-center bg-blue-50 border border-blue-400 text-blue-600 rounded py-2 text-[13px] font-semibold hover:bg-blue-100 transition-colors">
                  매도
                </button>
                {/* 다음날 버튼: 텍스트 없이 ChevronRight 아이콘만 */}
                <button onClick={() => advanceDays(1)} disabled={currentIndex + 1 >= allData.length}
                  className="flex items-center justify-center bg-emerald-50 border border-emerald-400 text-emerald-700 rounded py-2 px-3 text-sm font-semibold hover:bg-emerald-100 transition-colors disabled:opacity-40">
                  <ChevronRight size={16} />
                </button>
                {/* 3일 진행 */}
                <button onClick={() => advanceDays(3)} disabled={currentIndex + 1 >= allData.length}
                  title="3일 진행 (다음날 버튼 3번과 동일)"
                  className="flex items-center justify-center gap-0.5 bg-emerald-50 border border-emerald-300 text-emerald-600 rounded py-2 px-2.5 text-xs font-semibold hover:bg-emerald-100 transition-colors disabled:opacity-40">
                  <ChevronRight size={13} /><ChevronRight size={13} /> 3일
                </button>
              </div>

              <div className="mt-2 p-2 rounded-lg border border-gray-200 bg-gray-50 space-y-1.5">
                <div className="flex items-center gap-2">
                  <label className="text-[11px] text-gray-500 whitespace-nowrap">수량</label>
                  <input type="number" value={qty} onChange={e => setQty(e.target.value)} className="flex-1 h-7 bg-white border border-gray-300 rounded px-2 py-1 text-sm font-mono outline-none focus:border-blue-400" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => setQty(String(maxBuyQty))} className="text-xs py-1.5 rounded border border-red-300 text-red-600 hover:bg-red-50 transition-colors">최대 매수 ({maxBuyQty.toLocaleString()}주)</button>
                  <button onClick={() => setQty(String(maxSellQty))} className="text-xs py-1.5 rounded border border-blue-300 text-blue-600 hover:bg-blue-50 transition-colors">최대 매도 ({maxSellQty.toLocaleString()}주)</button>
                </div>
                <div className="grid grid-cols-5 gap-1.5">
                  {[5,10,20,50,75].map(pct => (
                    <button key={pct} onClick={() => setQty(prev => { const cur = Math.max(0, Math.floor(Number(prev) || 0)); return String(Math.max(1, Math.floor(cur * pct / 100))); })}
                      className="text-xs py-1.5 rounded border border-gray-300 text-gray-600 hover:bg-gray-100 hover:border-gray-400 transition-colors">{pct}%</button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-[11px] text-gray-500 whitespace-nowrap">예약 가격</label>
                  <input type="number" value={price} onChange={e => setPrice(e.target.value)} className="flex-1 h-7 bg-white border border-gray-300 rounded px-2 py-1 text-sm font-mono outline-none focus:border-blue-400" />
                  <button onClick={() => setPrice(today.close)} className="shrink-0 h-7 px-2 text-[10px] leading-none rounded border border-gray-300 text-gray-500 hover:text-gray-700 hover:border-gray-400 transition-colors">현재가로 맞추기</button>
                </div>
                <div className="text-[10px] text-gray-400">시장가 체결 가격: <span className="text-gray-700 font-mono">{fmt(today.close)}원 (당일 종가)</span></div>
              </div>

              {/* 예약(단일) 매수/매도 + 그리드 예약 */}
              <div className="grid grid-cols-3 gap-2 mt-3">
                <button onClick={() => placeLimitOrder('buy')} className="flex items-center justify-center bg-red-50 border border-red-300 text-red-600 rounded py-2 text-xs font-semibold hover:bg-red-100 transition-colors">예약 매수</button>
                <button onClick={() => placeLimitOrder('sell')} className="flex items-center justify-center bg-blue-50 border border-blue-300 text-blue-600 rounded py-2 text-xs font-semibold hover:bg-blue-100 transition-colors">예약 매도</button>
                <button onClick={() => { setGridBasePrice(Number(price) || today.close); setShowGridPanel(v => !v); }}
                  className={`flex items-center justify-center rounded py-2 text-xs font-semibold border transition-colors ${showGridPanel ? 'bg-amber-100 border-amber-400 text-amber-700' : 'bg-gray-50 border-gray-300 text-gray-600 hover:bg-gray-100'}`}>📶 그리드 예약</button>
              </div>
              <div className="grid grid-cols-2 gap-2 mt-2">
                <button onClick={() => cancelAllOrders('buy')} disabled={!pendingOrders.some(o => o.side === 'buy')}
                  className="text-[11px] py-1.5 rounded border border-red-200 text-red-500 hover:bg-red-50 hover:text-red-600 transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
                  매수예약 취소 ({pendingOrders.filter(o => o.side === 'buy').length}건)
                </button>
                <button onClick={() => cancelAllOrders('sell')} disabled={!pendingOrders.some(o => o.side === 'sell')}
                  className="text-[11px] py-1.5 rounded border border-blue-200 text-blue-500 hover:bg-blue-50 hover:text-blue-600 transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
                  매도예약 취소 ({pendingOrders.filter(o => o.side === 'sell').length}건)
                </button>
              </div>

              {showGridPanel && (
                <div className="mt-2 p-3 rounded-lg border border-amber-200 bg-amber-50 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-amber-700">그리드 예약</span>
                    <div className="flex rounded overflow-hidden border border-amber-200 text-[11px]">
                      <button onClick={() => setGridSide('buy')} className={`px-2 py-1 ${gridSide === 'buy' ? 'bg-red-100 text-red-600' : 'text-gray-500'}`}>매수</button>
                      <button onClick={() => setGridSide('sell')} className={`px-2 py-1 ${gridSide === 'sell' ? 'bg-blue-100 text-blue-600' : 'text-gray-500'}`}>매도</button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {[['기준 가격', gridBasePrice, setGridBasePrice],['가격 간격', gridStep, setGridStep],['단계별 수량', gridQtyPerStep, setGridQtyPerStep],['단계 수', gridSteps, setGridSteps]].map(([label, val, setter]) => (
                      <div key={label}><label className="text-[10px] text-gray-500">{label}</label><input type="number" value={val} onChange={e => setter(e.target.value)} className="w-full mt-0.5 bg-white border border-gray-300 rounded px-2 py-1.5 text-xs font-mono outline-none focus:border-blue-400" /></div>
                    ))}
                  </div>
                  <p className="text-[10px] text-gray-500">{gridSide === 'buy' ? '매수' : '매도'}: {fmt(Number(gridBasePrice) || 0)}원부터 {fmt(Number(gridStep) || 0)}원씩 {gridSide === 'buy' ? '내려가며' : '올라가며'} {fmt(Number(gridQtyPerStep) || 0)}주씩 {Number(gridSteps) || 0}건</p>
                  <button onClick={() => placeGridOrders(gridSide, gridBasePrice, gridStep, gridQtyPerStep, gridSteps)}
                    className="w-full text-xs py-2 rounded bg-amber-100 border border-amber-400 text-amber-700 hover:bg-amber-200 transition-colors font-semibold">그리드 예약 {gridSteps}건 등록</button>
                </div>
              )}

              <div className="mt-3 min-h-[2.25rem]">
                {message && <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">{message}</div>}
              </div>
            </div>

            {/* 거래량 차트 */}
            <div className="bg-white rounded-lg border border-gray-200 p-3">
              <ResponsiveContainer width="100%" height={90}>
                <BarChart data={chartData} margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={d => d.slice(5)} minTickGap={20} />
                  <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={v => (v / 1000) + 'k'} width={45} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="volume" isAnimationActive={false} shape={<VolumeBar />} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* 거래 내역 */}
            <div className="bg-white rounded-lg border border-gray-200 p-3">
              <h2 className="text-xs font-semibold text-gray-600 mb-2">거래 내역</h2>
              <div className="max-h-40 overflow-y-auto">
                {tradeLog.length === 0 ? <p className="text-xs text-gray-400 py-2">아직 거래 내역이 없습니다.</p> : (
                  <table className="w-full text-xs font-mono">
                    <thead><tr className="text-gray-400 text-left border-b border-gray-200"><th className="py-1">날짜</th><th>구분</th><th>방식</th><th className="text-right">수량</th><th className="text-right">가격</th><th className="text-right">금액</th></tr></thead>
                    <tbody>
                      {tradeLog.slice().reverse().map((t, i) => (
                        <tr key={i} className="border-b border-gray-100">
                          <td className="py-1">{t.date}</td>
                          <td className={t.action === 'BUY' ? 'text-red-600' : t.action === 'SELL' ? 'text-blue-600' : 'text-gray-400'}>{t.action === 'BUY' ? '매수' : t.action === 'SELL' ? '매도' : '취소'}</td>
                          <td className="text-gray-400">{t.orderType}</td>
                          <td className="text-right">{t.qty}</td>
                          <td className="text-right">{t.price ? fmt(t.price) : '-'}</td>
                          <td className="text-right">{t.price ? fmt(t.price * t.qty) : '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>

          {/* 우측: 계좌 정보 */}
          <div className="space-y-3">
            <div className="bg-white rounded-lg border border-gray-200 p-3 space-y-1.5 text-sm font-mono">
              {[['현금', fmt(cash) + '원'],['보유 수량', shares.toLocaleString() + '주'],['평단가', shares > 0 ? fmt(avgCost) + '원' : '-'],['현재가', fmt(today.close) + '원']].map(([label, val]) => (
                <div key={label} className="flex justify-between"><span className="text-gray-500">{label}</span><span className="text-gray-900">{val}</span></div>
              ))}
              {shares > 0 && (
                <>
                  <div className="h-px bg-gray-200 my-1"></div>
                  <div className="flex justify-between"><span className="text-gray-500">매수금액</span><span>{fmt(costBasis)}원</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">포지션 수익률</span><span className={positionReturnPct >= 0 ? 'text-red-600' : 'text-blue-600'}>{positionReturnPct >= 0 ? '+' : ''}{positionReturnPct.toFixed(2)}%</span></div>
                </>
              )}
              <div className="h-px bg-gray-200 my-1"></div>
              <div className="flex justify-between font-semibold"><span className="text-gray-700">평가금액</span><span>{fmt(portfolioValue)}원</span></div>
              <div className="flex justify-between"><span className="text-gray-500">이번 차트 손익</span><span className={chartPnl >= 0 ? 'text-red-600' : 'text-blue-600'}>{chartPnl >= 0 ? '+' : ''}{fmt(chartPnl)}원 ({chartReturnPct >= 0 ? '+' : ''}{chartReturnPct.toFixed(2)}%)</span></div>
              <div className="flex justify-between text-[11px]">
                <span className="text-gray-400">└ 이번 차트 보유 기간</span>
                <span className="text-gray-500">{currentChartHeldDays}거래일 · {currentChartHeldCalendarDays}일 · {currentChartHeldYears.toFixed(2)}년{positionOpenIdx !== null ? ' (진행 중)' : ''}{positionOpenIdx === null && pendingOrders.some(o => o.side === 'buy') ? ' (예약 대기)' : ''}</span>
              </div>
              <div className="flex justify-between"><span className="text-gray-500">전체 게임 손익</span><span className={gamePnl >= 0 ? 'text-red-600' : 'text-blue-600'}>{gamePnl >= 0 ? '+' : ''}{fmt(gamePnl)}원 ({returnPct >= 0 ? '+' : ''}{returnPct.toFixed(2)}%)</span></div>
              <div className="flex justify-between text-[11px]">
                <span className="text-gray-400">└ 전체 보유 기간 합계</span>
                <span className="text-gray-500">{gameTotalHeldDays}거래일 · {gameTotalHeldCalendarDays}일 · {gameTotalHeldYears.toFixed(2)}년</span>
              </div>
              {toppedUp > 0 && <div className="flex justify-between text-[11px]"><span className="text-gray-400">충전 누적</span><span className="text-gray-500">{fmt(toppedUp)}원</span></div>}
            </div>

            <div className="bg-white rounded-lg border border-gray-200 p-3">
              <h2 className="text-xs font-semibold text-gray-600 mb-2 flex items-center gap-1"><Clock size={12} /> 예약 주문</h2>
              {pendingOrders.length === 0 ? <p className="text-xs text-gray-400">예약된 주문이 없습니다.</p> : (
                <div className="space-y-1.5">
                  {pendingOrders.map(o => (
                    <div key={o.id} className="flex items-center justify-between bg-gray-50 rounded px-2 py-1.5 text-xs font-mono border border-gray-200">
                      <span className={o.side === 'buy' ? 'text-red-600' : 'text-blue-600'}>{o.side === 'buy' ? '매수' : '매도'} {o.qty}주 @ {fmt(o.price)}</span>
                      <button onClick={() => cancelOrder(o.id)} className="text-gray-400 hover:text-red-500"><X size={14} /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 학습 데이터 내보내기 모달 */}
      {exportCsv && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50 overflow-y-auto" onClick={() => setExportCsv(null)}>
          <div className="bg-white border border-gray-200 rounded-lg w-full max-w-2xl max-h-[90vh] flex flex-col my-auto shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">학습 데이터 내보내기</h2>
                {exportRange && <p className="text-[11px] text-gray-500 mt-0.5">{exportRange.from} ~ {exportRange.to} ({exportRange.count}일치)</p>}
              </div>
              <button onClick={() => setExportCsv(null)} className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-gray-300 text-gray-500 hover:text-gray-700 hover:border-gray-400 transition-colors"><X size={14} /> 닫기</button>
            </div>
            <textarea ref={exportTextareaRef} readOnly value={exportCsv} onFocus={e => e.target.select()} className="flex-1 m-3 bg-gray-50 border border-gray-200 rounded p-2 text-[11px] font-mono text-gray-700 outline-none resize-none min-h-[200px]" />
            <div className="flex gap-2 px-3 pb-3">
              <button onClick={downloadExportCsv} className="flex-1 flex items-center justify-center gap-1 bg-emerald-50 border border-emerald-400 text-emerald-700 rounded py-2 text-sm font-semibold hover:bg-emerald-100 transition-colors"><Download size={14} /> CSV 다운로드</button>
              <button onClick={copyExportCsv} className="flex-1 text-sm py-2 rounded border border-gray-300 text-gray-600 hover:border-gray-400 transition-colors">클립보드에 복사</button>
            </div>
            <div className="px-3 pb-3">
              <button onClick={() => setExportCsv(null)} className="w-full text-sm py-2 rounded border border-gray-300 text-gray-600 hover:border-gray-400 transition-colors">닫고 시뮬레이터로 돌아가기</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}