import React, { useState, useMemo, useRef } from 'react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, ReferenceDot, ReferenceLine
} from 'recharts';
import { ChevronRight, RotateCcw, Download, X, TrendingUp, TrendingDown, Clock, ZoomIn, ZoomOut, Maximize2, Upload } from 'lucide-react';

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
    data.push({
      idx: i,
      date: date.toISOString().slice(0, 10),
      open: Math.round(open),
      high: Math.round(high),
      low: Math.round(low),
      close: Math.round(close),
      volume,
      range: [Math.round(low), Math.round(high)],
    });
    price = close;
    date.setDate(date.getDate() + 1);
    while (date.getDay() === 0 || date.getDay() === 6) date.setDate(date.getDate() + 1);
  }
  for (let i = 0; i < data.length; i++) {
    const s = (n) => {
      let t = 0;
      for (let k = 0; k < n; k++) t += data[i - k].close;
      return Math.round(t / n);
    };
    if (i >= 4) data[i].ma5 = s(5);
    if (i >= 19) data[i].ma20 = s(20);
    if (i >= 59) data[i].ma60 = s(60);
    if (i >= 119) data[i].ma120 = s(120);
  }
  return data;
}

const fmt = (n) => Math.round(n).toLocaleString('ko-KR');

const calendarDaysBetween = (dateStrA, dateStrB) => {
  const a = new Date(dateStrA + 'T00:00:00');
  const b = new Date(dateStrB + 'T00:00:00');
  return Math.round((b - a) / 86400000);
};

function niceStep(range, targetTicks = 6) {
  if (!range || range <= 0) return 1;
  const rough = range / targetTicks;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  const nice = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  return nice * mag;
}

function parseCustomData(text) {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (!lines.length) return null;

  let rows = lines.map((l) => {
    let cols;
    if (l.includes('\t')) cols = l.split('\t');
    else if (l.includes(',')) cols = l.split(',');
    else cols = l.trim().split(/\s+/);
    return cols.map((c) => c.trim());
  });

  if (!/^\d{4}[-./]\d{1,2}[-./]\d{1,2}/.test(rows[0][0])) rows = rows.slice(1);

  const num = (v) => {
    if (v === undefined || v === '') return undefined;
    const n = Number(String(v).replace(/,/g, ''));
    return isNaN(n) ? undefined : n;
  };

  const data = rows.map((cols) => {
    const [date, open, high, low, close, ma5, ma20, ma60, ma120, volume] = cols;
    const o = num(open), h = num(high), l = num(low), c = num(close);
    if ([o, h, l, c].some((v) => v === undefined)) return null;
    return {
      date: (date || '').replace(/[./]/g, '-'),
      open: o,
      high: h,
      low: l,
      close: c,
      ma5: num(ma5),
      ma20: num(ma20),
      ma60: num(ma60),
      ma120: num(ma120),
      volume: num(volume) ?? 0,
      range: [l, h],
    };
  }).filter(Boolean);

  if (!data.length) return null;
  data.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  data.forEach((d, i) => { d.idx = i; });
  return data;
}

function listZipEntries(buffer) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('ZIP 형식을 인식할 수 없습니다.');
  const entryCount = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const entries = [];
  for (let i = 0; i < entryCount; i++) {
    if (view.getUint32(offset, true) !== 0x02014b50) break;
    const compMethod = view.getUint16(offset + 10, true);
    const compSize = view.getUint32(offset + 20, true);
    const uncompSize = view.getUint32(offset + 24, true);
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const lfhOffset = view.getUint32(offset + 42, true);
    const name = new TextDecoder('utf-8').decode(bytes.slice(offset + 46, offset + 46 + nameLen));
    entries.push({ name, compMethod, compSize, uncompSize, lfhOffset });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function getZipEntryText(buffer, entry) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const lfh = entry.lfhOffset;
  const nameLen = view.getUint16(lfh + 26, true);
  const extraLen = view.getUint16(lfh + 28, true);
  const dataStart = lfh + 30 + nameLen + extraLen;
  const compData = bytes.slice(dataStart, dataStart + entry.compSize);
  let outBytes;
  if (entry.compMethod === 0) {
    outBytes = compData;
  } else if (entry.compMethod === 8) {
    if (typeof DecompressionStream === 'undefined') throw new Error('이 브라우저는 ZIP 압축 해제를 지원하지 않습니다.');
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([compData]).stream().pipeThrough(ds);
    outBytes = new Uint8Array(await new Response(stream).arrayBuffer());
  } else {
    throw new Error(`지원하지 않는 압축 방식 (method ${entry.compMethod})`);
  }
  return new TextDecoder('utf-8').decode(outBytes);
}

const randomStart = (len) => {
  const minStart = Math.min(20, Math.max(0, len - 1));
  const maxStart = Math.max(minStart, len - 1 - 150);
  return minStart + Math.floor(Math.random() * (maxStart - minStart + 1));
};

const Candle = ({ x, y, width, height, payload }) => {
  if (!payload || payload.high === payload.low) return null;
  const isUp = payload.close >= payload.open;
  const color = isUp ? '#ef4444' : '#3b82f6';
  const scale = (v) => y + ((payload.high - v) / (payload.high - payload.low)) * height;
  const openY = scale(payload.open);
  const closeY = scale(payload.close);
  const bodyTop = Math.min(openY, closeY);
  const bodyH = Math.max(Math.abs(closeY - openY), 1);
  const cx = x + width / 2;
  const bodyW = Math.max(width * 0.6, 2);
  return (
    <g>
      <line x1={cx} y1={y} x2={cx} y2={y + height} stroke={color} strokeWidth={1} />
      <rect x={cx - bodyW / 2} y={bodyTop} width={bodyW} height={bodyH} fill={color} />
    </g>
  );
};

const VolumeBar = ({ x, y, width, height, payload }) => {
  const color = payload && payload.close >= payload.open ? '#ef444499' : '#3b82f699';
  return <rect x={x} y={y} width={width} height={height} fill={color} />;
};

const ChartTooltip = ({ active, payload }) => {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-[#1a2230] border border-[#2c3a4f] rounded px-3 py-2 text-xs text-slate-200 font-mono">
      <div className="text-slate-400 mb-1">{d.date}</div>
      <div>시 {fmt(d.open)} · 고 {fmt(d.high)}</div>
      <div>저 {fmt(d.low)} · 종 {fmt(d.close)}</div>
      <div className="text-slate-400">거래량 {fmt(d.volume)}</div>
    </div>
  );
};

const START_CASH = 10_000_000;

export default function TradingSimulator() {
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

  const currentChartHeldDays = positionOpenIdx !== null ? currentIndex - positionOpenIdx : 0;
  const currentChartHeldCalendarDays = positionOpenIdx !== null
    ? calendarDaysBetween(allData[positionOpenIdx].date, today.date)
    : 0;

  const gameTotalHeldDays = gameHeldDays + currentChartHeldDays;
  const gameTotalHeldCalendarDays = gameHeldCalendarDays + currentChartHeldCalendarDays;

  const { yDomain, yTicks } = useMemo(() => {
    const vis = visible.slice(-zoomDays);
    const vals = [];
    vis.forEach((d) => {
      vals.push(d.low, d.high);
      [d.ma5, d.ma20, d.ma60, d.ma120].forEach((v) => { if (v !== undefined && !isNaN(v)) vals.push(v); });
    });
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

  const log = (entry) => setTradeLog((prev) => [...prev, entry]);

  const trackPositionOnSharesChange = (prevShares, newShares, idxAtChange) => {
    if (prevShares === 0 && newShares > 0) {
      setPositionOpenIdx(idxAtChange);
    } else if (prevShares > 0 && newShares === 0) {
      setPositionOpenIdx((openIdx) => {
        if (openIdx !== null) {
          setGameHeldDays((d) => d + (idxAtChange - openIdx));
          setGameHeldCalendarDays((d) => d + calendarDaysBetween(allData[openIdx].date, allData[idxAtChange].date));
        }
        return null;
      });
    }
  };

  const placeMarketOrder = (orderSide) => {
    const q = Number(qty);
    if (!q || q <= 0) { setMessage('수량을 입력해주세요.'); return; }
    setMessage(null);
    const p = today.close;
    if (orderSide === 'buy') {
      const cost = p * q;
      if (cost > cash) { setMessage(`현금이 부족합니다. 필요 ${fmt(cost)}원 / 잔고 ${fmt(cash)}원`); return; }
      const newShares = shares + q;
      setAvgCost((avgCost * shares + cost) / newShares);
      setShares(newShares);
      setCash((c) => c - cost);
      trackPositionOnSharesChange(shares, newShares, currentIndex);
      log({ date: today.date, idx: currentIndex, action: 'BUY', orderType: '시장가', qty: q, price: p });
    } else {
      if (q > shares) { setMessage(`보유 수량(${shares}주)보다 많습니다.`); return; }
      const newShares = shares - q;
      setShares(newShares);
      if (newShares === 0) setAvgCost(0);
      setCash((c) => c + p * q);
      trackPositionOnSharesChange(shares, newShares, currentIndex);
      log({ date: today.date, idx: currentIndex, action: 'SELL', orderType: '시장가', qty: q, price: p });
    }
  };

  const placeLimitOrder = (orderSide) => {
    const q = Number(qty);
    if (!q || q <= 0) { setMessage('수량을 입력해주세요.'); return; }
    const p = Number(price);
    if (!p || p <= 0) { setMessage('예약 가격을 입력해주세요.'); return; }
    setMessage(null);
    setPendingOrders((prev) => [...prev, { id: `limit:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`, side: orderSide, qty: q, price: p, placedDate: today.date }]);
  };

  const placeGridOrders = (orderSide, basePrice, step, qtyPerStep, steps) => {
    const b = Number(basePrice), s = Number(step), q = Number(qtyPerStep), n = Number(steps);
    if (!b || b <= 0) { setMessage('기준 가격을 입력해주세요.'); return; }
    if (!s || s <= 0) { setMessage('가격 간격을 입력해주세요.'); return; }
    if (!q || q <= 0) { setMessage('단계별 수량을 입력해주세요.'); return; }
    if (!n || n <= 0) { setMessage('단계 수를 입력해주세요.'); return; }

    const newOrders = [];
    for (let i = 0; i < n; i++) {
      const stepPrice = orderSide === 'buy' ? b - s * i : b + s * i;
      if (stepPrice <= 0) break;
      newOrders.push({
        id: `grid:${Date.now()}:${i}:${Math.random().toString(36).slice(2, 8)}`,
        side: orderSide, qty: q, price: Math.round(stepPrice), placedDate: today.date,
      });
    }
    if (!newOrders.length) { setMessage('등록할 예약 주문이 없습니다. 입력값을 확인해주세요.'); return; }

    setPendingOrders((prev) => [...prev, ...newOrders]);

    if (orderSide === 'buy') {
      const totalCost = newOrders.reduce((sum, o) => sum + o.price * o.qty, 0);
      if (totalCost > cash) {
        setMessage(`매수 그리드 ${newOrders.length}건 등록 완료 (가격: ${fmt(newOrders[0].price)}~${fmt(newOrders[newOrders.length - 1].price)}원). 단, 전부 체결되려면 ${fmt(totalCost)}원이 필요한데 현재 현금은 ${fmt(cash)}원입니다 — 현금이 부족한 주문은 그날 체결되지 않고 대기 상태로 남습니다.`);
      } else {
        setMessage(`매수 그리드 예약 ${newOrders.length}건 등록 완료 (가격: ${fmt(newOrders[0].price)}원 ~ ${fmt(newOrders[newOrders.length - 1].price)}원)`);
      }
    } else {
      const totalQty = newOrders.reduce((sum, o) => sum + o.qty, 0);
      if (totalQty > shares) {
        setMessage(`매도 그리드 ${newOrders.length}건 등록 완료 (가격: ${fmt(newOrders[0].price)}~${fmt(newOrders[newOrders.length - 1].price)}원). 단, 전부 체결되려면 ${totalQty}주가 필요한데 현재 보유 수량은 ${shares}주입니다 — 수량이 부족한 주문은 체결되지 않습니다.`);
      } else {
        setMessage(`매도 그리드 예약 ${newOrders.length}건 등록 완료 (가격: ${fmt(newOrders[0].price)}원 ~ ${fmt(newOrders[newOrders.length - 1].price)}원)`);
      }
    }
    setShowGridPanel(false);
  };

  const cancelOrder = (id) => {
    const o = pendingOrders.find((x) => x.id === id);
    if (o) log({ date: today.date, idx: currentIndex, action: 'CANCEL', orderType: '예약', qty: o.qty, price: o.price });
    setPendingOrders((prev) => prev.filter((x) => x.id !== id));
  };

  const cancelAllOrders = (side) => {
    const toCancel = pendingOrders.filter((o) => o.side === side);
    if (!toCancel.length) {
      setMessage(`취소할 ${side === 'buy' ? '매수' : '매도'} 예약 주문이 없습니다.`);
      return;
    }
    toCancel.forEach((o) => {
      log({ date: today.date, idx: currentIndex, action: 'CANCEL', orderType: '예약(일괄취소)', qty: o.qty, price: o.price });
    });
    setPendingOrders((prev) => prev.filter((o) => o.side !== side));
    setMessage(`${side === 'buy' ? '매수' : '매도'} 예약 ${toCancel.length}건을 모두 취소했습니다.`);
  };

  const nextDay = () => {
    if (currentIndex + 1 >= allData.length) return;
    setMessage(null);
    const next = allData[currentIndex + 1];
    let nextCash = cash, nextShares = shares, nextAvg = avgCost;
    const remaining = [], newLogs = [];
    pendingOrders.forEach((order) => {
      const filled = order.side === 'buy' ? next.low <= order.price : next.high >= order.price;
      if (filled) {
        if (order.side === 'buy') {
          const cost = order.price * order.qty;
          if (cost <= nextCash) {
            const ns = nextShares + order.qty;
            nextAvg = (nextAvg * nextShares + cost) / ns;
            nextShares = ns;
            nextCash -= cost;
            newLogs.push({ date: next.date, idx: currentIndex + 1, action: 'BUY', orderType: '예약(체결)', qty: order.qty, price: order.price });
          } else {
            remaining.push(order);
          }
        } else {
          if (order.qty <= nextShares) {
            nextShares -= order.qty;
            nextCash += order.price * order.qty;
            if (nextShares === 0) nextAvg = 0;
            newLogs.push({ date: next.date, idx: currentIndex + 1, action: 'SELL', orderType: '예약(체결)', qty: order.qty, price: order.price });
          } else {
            remaining.push(order);
          }
        }
      } else {
        remaining.push(order);
      }
    });
    setCash(nextCash);
    setAvgCost(nextAvg);
    setPendingOrders(remaining);
    if (newLogs.length) setTradeLog((prev) => [...prev, ...newLogs]);
    setShares((prevShares) => {
      trackPositionOnSharesChange(prevShares, nextShares, currentIndex + 1);
      return nextShares;
    });
    setCurrentIndex((i) => i + 1);
  };

  const applyDataset = (data, name, keepAccount = false, chartStartSnapshot = START_CASH) => {
    const start = randomStart(data.length);
    setAllData(data);
    setDataSource(name);
    setCurrentIndex(start);
    if (!keepAccount) {
      setCash(START_CASH);
      setShares(0);
      setAvgCost(0);
      setToppedUp(0);
      setGameHeldDays(0);
      setGameHeldCalendarDays(0);
    }
    setPendingOrders([]);
    setTradeLog([]);
    setPositionOpenIdx(null);
    setChartStartValue(chartStartSnapshot);
    setChartToppedUp(0);
    setQty(10);
    setPrice(data[start].close);
    setMessage(null);
    setShowDataPanel(false);
  };

  const getParsedDataset = async (entry) => {
    if (parseCacheRef.current.has(entry.id)) return parseCacheRef.current.get(entry.id);
    const text = entry.kind === 'zip' ? await getZipEntryText(entry.buffer, entry.zipEntry) : entry.raw;
    const parsed = parseCustomData(text);
    if (parsed) parseCacheRef.current.set(entry.id, parsed);
    return parsed;
  };

  const useEntry = async (entry) => {
    setMessage('데이터를 불러오는 중...');
    try {
      const parsed = await getParsedDataset(entry);
      if (!parsed || parsed.length < 2) { setMessage(`"${entry.name}" 데이터를 확인해주세요.`); return; }
      applyDataset(parsed, entry.name);
    } catch (err) {
      setMessage(`"${entry.name}" 불러오기 실패: ${err.message || err}`);
    }
  };

  const resetAll = async () => {
    setMessage(null);
    if (!customDatasets.length) { applyDataset(generateData(300), '랜덤 데이터'); return; }
    const pick = customDatasets[Math.floor(Math.random() * customDatasets.length)];
    setMessage('데이터를 불러오는 중...');
    try {
      const parsed = await getParsedDataset(pick);
      if (!parsed || parsed.length < 2) { applyDataset(generateData(300), '랜덤 데이터'); return; }
      applyDataset(parsed, pick.name);
    } catch {
      applyDataset(generateData(300), '랜덤 데이터');
    }
  };

  const liquidateHoldings = () => {
    let finalCash = cash;
    if (shares > 0) {
      const proceeds = shares * today.close;
      finalCash = cash + proceeds;
      setCash(finalCash);
      setTradeLog((prev) => [...prev, {
        date: today.date,
        idx: currentIndex,
        action: 'SELL',
        orderType: '차트 전환(전량 청산)',
        qty: shares,
        price: today.close,
      }]);
      setShares(0);
      setAvgCost(0);
      trackPositionOnSharesChange(shares, 0, currentIndex);
    }
    setPendingOrders([]);
    return finalCash;
  };

  const refreshChartOnly = async () => {
    setMessage(null);
    const snapshot = liquidateHoldings();
    if (!customDatasets.length) { applyDataset(generateData(300), '랜덤 데이터', true, snapshot); return; }
    const pick = customDatasets[Math.floor(Math.random() * customDatasets.length)];
    setMessage('차트를 불러오는 중...');
    try {
      const parsed = await getParsedDataset(pick);
      if (!parsed || parsed.length < 2) { applyDataset(generateData(300), '랜덤 데이터', true, snapshot); return; }
      applyDataset(parsed, pick.name, true, snapshot);
    } catch {
      applyDataset(generateData(300), '랜덤 데이터', true, snapshot);
    }
  };

  const topUpCash = () => {
    setCash((c) => c + START_CASH);
    setToppedUp((t) => t + START_CASH);
    setChartToppedUp((t) => t + START_CASH);
    setMessage(`현금 ${fmt(START_CASH)}원이 충전되었습니다.`);
  };

  const applyCustomData = () => {
    const parsed = parseCustomData(csvText);
    if (!parsed || parsed.length < 2) { setMessage('데이터 형식을 확인해주세요. (날짜,시가,고가,저가,종가,MA5,MA20,MA60,MA120,거래량)'); return; }
    const entryName = `붙여넣은 데이터 ${customDatasets.length + 1}`;
    const id = `paste:${Date.now()}`;
    parseCacheRef.current.set(id, parsed);
    setCustomDatasets((prev) => [...prev, { id, name: entryName, kind: 'text', raw: csvText }]);
    applyDataset(parsed, entryName);
  };

  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setMessage('파일을 확인하는 중...');
    const newEntries = [];
    for (const file of files) {
      try {
        if (/\.zip$/i.test(file.name)) {
          const buffer = await file.arrayBuffer();
          const zipEntries = listZipEntries(buffer);
          zipEntries
            .filter((en) => /\.(csv|txt)$/i.test(en.name) && en.uncompSize > 0 && !en.name.includes('__MACOSX') && !en.name.split('/').pop().startsWith('.'))
            .forEach((en) => newEntries.push({ id: `zip:${file.name}::${en.name}`, name: `${file.name} / ${en.name}`, kind: 'zip', buffer, zipEntry: en }));
        } else {
          const text = await file.text();
          newEntries.push({ id: `file:${file.name}:${file.size}`, name: file.name, kind: 'text', raw: text });
        }
      } catch (err) {
        setMessage(`"${file.name}" 처리 중 오류: ${err.message}`);
      }
    }
    if (!newEntries.length) { setMessage('인식 가능한 CSV/TXT 파일을 찾지 못했습니다.'); e.target.value = ''; return; }
    setCustomDatasets((prev) => [...prev, ...newEntries]);
    const pick = newEntries[Math.floor(Math.random() * newEntries.length)];
    await useEntry(pick);
    e.target.value = '';
  };

  const removeDataset = (i) => {
    setCustomDatasets((prev) => {
      const removed = prev[i];
      if (removed) parseCacheRef.current.delete(removed.id);
      return prev.filter((_, idx) => idx !== i);
    });
  };

  const exportTraining = () => {
    const validTrades = tradeLog.filter((t) => t.action !== 'CANCEL');
    if (!validTrades.length) { setMessage('내보낼 거래 내역이 없습니다. 매수 또는 매도를 먼저 진행해주세요.'); return; }
    const minIdx = Math.min(...validTrades.map((t) => t.idx));
    const maxIdx = Math.max(...validTrades.map((t) => t.idx));
    const byDate = {};
    validTrades.forEach((t) => { (byDate[t.date] = byDate[t.date] || []).push(t); });
    const header = ['date','open','high','low','close','volume','ma5','ma20','ma60','ma120','label','qty','order_price','order_type'];
    const rows = [header.join(',')];
    for (let i = minIdx; i <= maxIdx; i++) {
      const d = allData[i];
      const ts = byDate[d.date];
      if (ts?.length) {
        ts.forEach((t) => rows.push([d.date,d.open,d.high,d.low,d.close,d.volume,d.ma5??'',d.ma20??'',d.ma60??'',d.ma120??'',t.action,t.qty,t.price,t.orderType].join(',')));
      } else {
        rows.push([d.date,d.open,d.high,d.low,d.close,d.volume,d.ma5??'',d.ma20??'',d.ma60??'',d.ma120??'','HOLD',0,'',''].join(','));
      }
    }
    setExportCsv(rows.join('\n'));
    setExportRange({ from: allData[minIdx].date, to: allData[maxIdx].date, count: maxIdx - minIdx + 1 });
  };

  const downloadExportCsv = () => {
    if (!exportCsv) return;
    try {
      const url = URL.createObjectURL(new Blob([exportCsv], { type: 'text/csv;charset=utf-8;' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `training_${exportRange?.from}_to_${exportRange?.to}_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setMessage('다운로드 실패. 텍스트를 직접 복사해주세요.');
    }
  };

  const copyExportCsv = async () => {
    if (!exportCsv) return;
    try { await navigator.clipboard.writeText(exportCsv); setMessage('클립보드에 복사했습니다.'); return; } catch {}
    try {
      const ta = exportTextareaRef.current;
      if (ta) { ta.focus(); ta.select(); if (document.execCommand('copy')) { setMessage('클립보드에 복사했습니다.'); return; } }
    } catch {}
    setMessage('자동 복사 실패. 텍스트 영역 클릭 후 Ctrl+C로 복사해주세요.');
    exportTextareaRef.current?.focus();
    exportTextareaRef.current?.select();
  };

  const visibleTrades = useMemo(
    () => tradeLog.filter((t) => t.idx >= (chartData[0]?.idx ?? 0) && t.action !== 'CANCEL'),
    [tradeLog, chartData]
  );

  return (
    <div className="min-h-screen bg-[#0d1320] text-slate-200 font-sans p-4 md:p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div>
            <h1 className="text-lg md:text-xl font-bold tracking-tight text-slate-100">매매 연습 시뮬레이터</h1>
            <p className="text-xs text-slate-500 font-mono mt-0.5">DAY {currentIndex + 1} / {allData.length} · {today.date}</p>
            <p className="text-[11px] text-slate-400 mt-0.5">데이터: <span className="text-slate-300 font-medium">{dataSource}</span></p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => setShowDataPanel((v) => !v)} className="text-xs px-3 py-2 rounded border border-[#2c3a4f] text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors">
              데이터 입력
            </button>
            <button onClick={refreshChartOnly} title="보유 주식을 현재가로 전량 매도한 뒤, 현금/누적 수익은 유지하고 차트(종목·구간)만 새로 불러옵니다" className="flex items-center gap-1 text-xs px-3 py-2 rounded border border-[#2c3a4f] text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors">
              <ZoomIn size={14} /> 차트 새로고침
            </button>
            <button onClick={topUpCash} title={`현금을 ${fmt(START_CASH)}원 추가로 충전합니다`} className="flex items-center gap-1 text-xs px-3 py-2 rounded border border-amber-700/60 text-amber-400 hover:bg-amber-600/10 transition-colors">
              💰 금액 충전
            </button>
            <button onClick={resetAll} title="현금/보유주식/수익률을 모두 초기화하고 새 차트로 시작합니다" className="flex items-center gap-1 text-xs px-3 py-2 rounded border border-[#2c3a4f] text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors">
              <RotateCcw size={14} /> 초기화
            </button>
            <button onClick={exportTraining} className="flex items-center gap-1 text-xs px-3 py-2 rounded bg-emerald-600/20 border border-emerald-700 text-emerald-400 hover:bg-emerald-600/30 transition-colors">
              <Download size={14} /> 학습 데이터 내보내기
            </button>
          </div>
        </div>
        {showDataPanel && (
          <div className="bg-[#131b2c] rounded-lg border border-[#1f2b3e] p-3 mb-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold text-slate-400">데이터 불러오기</h2>
              <span className="text-[10px] text-slate-500">현재: {dataSource} ({allData.length}일)</span>
            </div>
            <div className="border border-dashed border-[#2c3a4f] rounded-lg p-4 text-center">
              <label className="inline-flex items-center gap-2 text-sm px-4 py-2 rounded bg-emerald-600/20 border border-emerald-700 text-emerald-400 hover:bg-emerald-600/30 transition-colors cursor-pointer">
                <Upload size={14} /> .csv / .txt / .zip 파일 업로드 (여러 개 가능)
                <input type="file" accept=".csv,.txt,.zip" multiple onChange={handleFileUpload} className="hidden" />
              </label>
              <p className="text-[10px] text-slate-500 mt-2">
                ZIP 파일을 올리면 그 안의 CSV 목록만 읽어 등록합니다 (압축 해제는 실제 사용 시점에만). 여러 파일을 등록해두면 초기화할 때마다 그중 하나와 랜덤 구간으로 시작합니다.<br />
                형식: 날짜,시가,고가,저가,종가,MA5,MA20,MA60,MA120,거래량 (탭/쉼표/공백 구분, 헤더 있어도 됨, 날짜 최신순/과거순 모두 자동 인식, 이동평균 빈 칸 허용)
              </p>
            </div>
            {customDatasets.length > 0 && (
              <div>
                <p className="text-[11px] text-slate-500 mb-1">등록된 데이터 ({customDatasets.length}개) — 초기화 시 이 목록 중 무작위 선택</p>
                <div className="space-y-1">
                  {customDatasets.map((d, i) => (
                    <div key={d.id} className="flex items-center justify-between bg-[#0d1320] rounded px-2 py-1.5 text-xs">
                      <span className="text-slate-300 truncate mr-2">{d.name} <span className="text-slate-500">({d.kind === 'zip' ? 'ZIP 내부' : '파일'})</span></span>
                      <div className="flex items-center gap-2 shrink-0">
                        <button onClick={() => useEntry(d)} className="text-emerald-400 hover:text-emerald-300">사용</button>
                        <button onClick={() => removeDataset(i)} className="text-slate-500 hover:text-red-400"><X size={13} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <details className="text-xs">
              <summary className="cursor-pointer text-slate-400 hover:text-slate-200">직접 텍스트로 붙여넣기</summary>
              <div className="mt-2 space-y-2">
                <textarea
                  value={csvText} onChange={(e) => setCsvText(e.target.value)}
                  placeholder={'2024-01-02,50000,50500,49800,50200,,,,,123456\n2024-01-03,50200,51000,50000,50800,50400,,,,98000\n...'}
                  className="w-full h-32 bg-[#0d1320] border border-[#2c3a4f] rounded px-2 py-2 text-xs font-mono outline-none focus:border-slate-500 resize-y"
                />
                <button onClick={applyCustomData} className="text-xs px-3 py-1.5 rounded bg-emerald-600/20 border border-emerald-700 text-emerald-400 hover:bg-emerald-600/30 transition-colors">
                  이 데이터로 시작 (목록에 추가됨)
                </button>
              </div>
            </details>
            <button onClick={() => { applyDataset(generateData(300), '랜덤 데이터'); }} className="text-xs px-3 py-1.5 rounded border border-[#2c3a4f] text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors">
              랜덤 데이터로 시작
            </button>
          </div>
        )}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4">
          <div className="space-y-2">
            <div className="bg-[#131b2c] rounded-lg border border-[#1f2b3e] p-3">
              <div className="flex items-center justify-between mb-2 flex-wrap gap-1">
                <span className="text-[11px] text-slate-500 font-mono">표시: {Math.min(zoomDays, visible.length)}일</span>
                <div className="flex items-center gap-1 flex-wrap">
                  <button onClick={() => setZoomDays((z) => Math.max(10, z - 10))} className="p-1.5 rounded border border-[#2c3a4f] text-slate-400 hover:text-slate-200 transition-colors"><ZoomOut size={13} /></button>
                  <button onClick={() => setZoomDays((z) => Math.min(allData.length, z + 10))} className="p-1.5 rounded border border-[#2c3a4f] text-slate-400 hover:text-slate-200 transition-colors"><ZoomIn size={13} /></button>
                  {[60, 120, 250, 500].map((n) => (
                    <button key={n} onClick={() => setZoomDays(n)}
                      className={`text-[11px] px-2 py-1 rounded border ${zoomDays === n ? 'border-slate-400 text-slate-200' : 'border-[#2c3a4f] text-slate-500'} hover:text-slate-200 hover:border-slate-500 transition-colors`}>
                      {n}일
                    </button>
                  ))}
                  <button onClick={() => setZoomDays(allData.length)}
                    className={`text-[11px] px-2 py-1 rounded border flex items-center gap-1 ${zoomDays >= allData.length ? 'border-slate-400 text-slate-200' : 'border-[#2c3a4f] text-slate-500'} hover:text-slate-200 hover:border-slate-500 transition-colors`}>
                    <Maximize2 size={11} /> 전체
                  </button>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={320}>
                <ComposedChart data={chartData} margin={{ top: 5, right: 70, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="#1f2b3e" strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#64748b' }} tickFormatter={(d) => d.slice(5)} minTickGap={20} />
                  <YAxis domain={yDomain} ticks={yTicks} tick={{ fontSize: 10, fill: '#64748b' }} tickFormatter={(v) => v.toLocaleString()} width={55} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="range" shape={<Candle />} isAnimationActive={false} />
                  <Line type="monotone" dataKey="ma5" stroke="#fbbf24" dot={false} strokeWidth={1.2} isAnimationActive={false} connectNulls />
                  <Line type="monotone" dataKey="ma20" stroke="#a78bfa" dot={false} strokeWidth={1.2} isAnimationActive={false} connectNulls />
                  <Line type="monotone" dataKey="ma60" stroke="#34d399" dot={false} strokeWidth={1.2} isAnimationActive={false} connectNulls />
                  <Line type="monotone" dataKey="ma120" stroke="#f472b6" dot={false} strokeWidth={1.2} isAnimationActive={false} connectNulls />
                  <ReferenceLine y={today.close} stroke="#94a3b8" strokeDasharray="4 4" strokeWidth={1}
                    label={(props) => {
                      const { viewBox } = props;
                      const text = fmt(today.close);
                      const w = text.length * 8 + 12;
                      const x = viewBox.x + viewBox.width + 2;
                      const y = viewBox.y;
                      return (
                        <text x={x + w / 2} y={y + 4} textAnchor="middle" fontSize={13} fontWeight={700} fill="#000000" stroke="#ffffff" strokeWidth={3} paintOrder="stroke">
                          {text}
                        </text>
                      );
                    }} />
                  {visibleTrades.map((t, i) => {
                    const isBuy = t.action === 'BUY';
                    const color = isBuy ? '#ef4444' : '#3b82f6';
                    return (
                      <ReferenceDot key={i} x={t.date} y={t.price} r={5} fill={color} stroke="#0d1320" strokeWidth={1.5} isFront
                        label={(props) => {
                          const { viewBox } = props;
                          return (
                            <text x={viewBox.x} y={viewBox.y + (isBuy ? 16 : -10)} textAnchor="middle" fontSize={10} fontFamily="monospace" fill={color}>
                              {isBuy ? '매수' : '매도'} {t.qty}@{fmt(t.price)}
                            </text>
                          );
                        }} />
                    );
                  })}
                </ComposedChart>
              </ResponsiveContainer>
              <div className="flex gap-4 text-[10px] text-slate-500 px-2 mt-1 flex-wrap">
                {[['bg-amber-400','MA5'],['bg-violet-400','MA20'],['bg-emerald-400','MA60'],['bg-pink-400','MA120'],['bg-red-500','매수'],['bg-blue-500','매도']].map(([cls, label]) => (
                  <span key={label} className="flex items-center gap-1"><span className={`w-2 h-2 ${cls} inline-block rounded-full`}></span>{label}</span>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-2 mt-3">
                <button onClick={() => placeMarketOrder('buy')} className="flex items-center justify-center gap-1 bg-red-600/20 border border-red-700 text-red-400 rounded py-2.5 text-sm font-semibold hover:bg-red-600/30 transition-colors">
                  <TrendingUp size={14} /> 시장가 매수
                </button>
                <button onClick={() => placeMarketOrder('sell')} className="flex items-center justify-center gap-1 bg-blue-600/20 border border-blue-700 text-blue-400 rounded py-2.5 text-sm font-semibold hover:bg-blue-600/30 transition-colors">
                  <TrendingDown size={14} /> 시장가 매도
                </button>
                <button onClick={nextDay} disabled={currentIndex + 1 >= allData.length}
                  className="flex items-center justify-center gap-1 bg-emerald-600/20 border border-emerald-700 text-emerald-400 rounded py-2.5 text-sm font-semibold hover:bg-emerald-600/30 transition-colors disabled:opacity-40">
                  다음날 <ChevronRight size={16} />
                </button>
              </div>
              <p className="text-[10px] text-slate-500 mt-1">"시장가 매도"는 아래 입력된 수량만큼 즉시 당일 종가로 매도합니다. 보유 수량 전체를 팔고 싶으면 "최대 매도" 버튼으로 수량을 채운 뒤 누르세요.</p>
              <div className="grid grid-cols-3 gap-2 mt-3">
                <button onClick={() => placeLimitOrder('buy')} className="flex items-center justify-center gap-1 bg-red-600/10 border border-red-800 text-red-300 rounded py-2 text-xs font-semibold hover:bg-red-600/20 transition-colors">
                  예약 매수
                </button>
                <button onClick={() => placeLimitOrder('sell')} className="flex items-center justify-center gap-1 bg-blue-600/10 border border-blue-800 text-blue-300 rounded py-2 text-xs font-semibold hover:bg-blue-600/20 transition-colors">
                  예약 매도
                </button>
                <button onClick={() => { setGridBasePrice(Number(price) || today.close); setShowGridPanel((v) => !v); }}
                  className={`flex items-center justify-center gap-1 rounded py-2 text-xs font-semibold border transition-colors ${showGridPanel ? 'bg-amber-600/20 border-amber-700 text-amber-300' : 'bg-[#0d1320] border-[#2c3a4f] text-slate-400 hover:text-slate-200 hover:border-slate-500'}`}>
                  📶 그리드 예약
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2 mt-2">
                <button
                  onClick={() => cancelAllOrders('buy')}
                  disabled={!pendingOrders.some((o) => o.side === 'buy')}
                  className="text-[11px] py-1.5 rounded border border-red-700/40 text-red-400/80 hover:bg-red-600/10 hover:text-red-400 transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
                  매수예약 취소 ({pendingOrders.filter((o) => o.side === 'buy').length}건)
                </button>
                <button
                  onClick={() => cancelAllOrders('sell')}
                  disabled={!pendingOrders.some((o) => o.side === 'sell')}
                  className="text-[11px] py-1.5 rounded border border-blue-700/40 text-blue-400/80 hover:bg-blue-600/10 hover:text-blue-400 transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
                  매도예약 취소 ({pendingOrders.filter((o) => o.side === 'sell').length}건)
                </button>
              </div>
              {showGridPanel && (
                <div className="mt-2 p-3 rounded-lg border border-amber-800/50 bg-amber-500/5 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-amber-300">그리드 예약 — 가격 구간을 정해 일정 간격으로 여러 건 등록</span>
                    <div className="flex rounded overflow-hidden border border-[#2c3a4f] text-[11px]">
                      <button onClick={() => setGridSide('buy')} className={`px-2 py-1 ${gridSide === 'buy' ? 'bg-red-600/30 text-red-300' : 'text-slate-400'}`}>매수</button>
                      <button onClick={() => setGridSide('sell')} className={`px-2 py-1 ${gridSide === 'sell' ? 'bg-blue-600/30 text-blue-300' : 'text-slate-400'}`}>매도</button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-slate-500">기준 가격</label>
                      <input type="number" value={gridBasePrice} onChange={(e) => setGridBasePrice(e.target.value)}
                        className="w-full mt-0.5 bg-[#0d1320] border border-[#2c3a4f] rounded px-2 py-1.5 text-xs font-mono outline-none focus:border-slate-500" />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-500">가격 간격</label>
                      <input type="number" value={gridStep} onChange={(e) => setGridStep(e.target.value)}
                        className="w-full mt-0.5 bg-[#0d1320] border border-[#2c3a4f] rounded px-2 py-1.5 text-xs font-mono outline-none focus:border-slate-500" />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-500">단계별 수량</label>
                      <input type="number" value={gridQtyPerStep} onChange={(e) => setGridQtyPerStep(e.target.value)}
                        className="w-full mt-0.5 bg-[#0d1320] border border-[#2c3a4f] rounded px-2 py-1.5 text-xs font-mono outline-none focus:border-slate-500" />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-500">단계 수</label>
                      <input type="number" value={gridSteps} onChange={(e) => setGridSteps(e.target.value)}
                        className="w-full mt-0.5 bg-[#0d1320] border border-[#2c3a4f] rounded px-2 py-1.5 text-xs font-mono outline-none focus:border-slate-500" />
                    </div>
                  </div>
                  <p className="text-[10px] text-slate-500">
                    {gridSide === 'buy' ? '매수' : '매도'}: {fmt(Number(gridBasePrice) || 0)}원부터 {fmt(Number(gridStep) || 0)}원씩 {gridSide === 'buy' ? '내려가며' : '올라가며'} {fmt(Number(gridQtyPerStep) || 0)}주씩 {Number(gridSteps) || 0}건 등록<br />
                    가격 범위: {fmt(Number(gridBasePrice) || 0)}원 ~ {fmt(gridSide === 'buy' ? (Number(gridBasePrice) || 0) - (Number(gridStep) || 0) * ((Number(gridSteps) || 1) - 1) : (Number(gridBasePrice) || 0) + (Number(gridStep) || 0) * ((Number(gridSteps) || 1) - 1))}원 · 총 수량: {fmt((Number(gridQtyPerStep) || 0) * (Number(gridSteps) || 0))}주
                  </p>
                  <button
                    onClick={() => placeGridOrders(gridSide, gridBasePrice, gridStep, gridQtyPerStep, gridSteps)}
                    className="w-full text-xs py-2 rounded bg-amber-600/20 border border-amber-700 text-amber-300 hover:bg-amber-600/30 transition-colors font-semibold">
                    그리드 예약 {gridSteps}건 등록
                  </button>
                </div>
              )}
              <div className="mt-2">
                <label className="text-[11px] text-slate-500">수량 (시장가·단일 예약 주문에 공통 사용)</label>
                <input type="number" value={qty} onChange={(e) => setQty(e.target.value)}
                  className="w-full mt-1 bg-[#0d1320] border border-[#2c3a4f] rounded px-2 py-1.5 text-sm font-mono outline-none focus:border-slate-500" />
              </div>
              <div className="grid grid-cols-2 gap-2 mt-2">
                <button onClick={() => setQty(String(maxBuyQty))} className="text-xs py-1.5 rounded border border-red-700/60 text-red-400 hover:bg-red-600/10 transition-colors">
                  최대 매수 ({maxBuyQty.toLocaleString()}주)
                </button>
                <button onClick={() => setQty(String(maxSellQty))} className="text-xs py-1.5 rounded border border-blue-700/60 text-blue-400 hover:bg-blue-600/10 transition-colors">
                  최대 매도 ({maxSellQty.toLocaleString()}주)
                </button>
              </div>
              <div className="grid grid-cols-5 gap-1.5 mt-2">
                {[5,10,20,50,75].map((pct) => (
                  <button key={pct}
                    onClick={() => {
                      setQty((prev) => {
                        const cur = Math.max(0, Math.floor(Number(prev) || 0));
                        const next = Math.max(1, Math.floor(cur * pct / 100));
                        return String(next);
                      });
                    }}
                    className="text-xs py-1.5 rounded border border-[#2c3a4f] text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors">
                    {pct}%
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-slate-500 mt-1">% 버튼: 현재 입력된 수량의 N%로 바꿉니다. 예: 100주에서 10% → 10주, 다시 10% → 1주.</p>
              <div className="mt-2">
                <label className="text-[11px] text-slate-500">예약 가격 (예약 매수/매도 공통)</label>
                <input type="number" value={price} onChange={(e) => setPrice(e.target.value)}
                  className="w-full mt-1 bg-[#0d1320] border border-[#2c3a4f] rounded px-2 py-1.5 text-sm font-mono outline-none focus:border-slate-500" />
                <p className="text-[10px] text-slate-500 mt-1">매수: 저가가 이 가격 이하로 떨어지면 체결 / 매도: 고가가 이 가격 이상으로 오르면 체결</p>
              </div>
              <div className="text-[11px] text-slate-500 mt-2">시장가 체결 가격: <span className="text-slate-300 font-mono">{fmt(today.close)}원 (당일 종가)</span></div>
              <div className="mt-3 min-h-[2.25rem]">
                {message && (
                  <div className="text-xs text-amber-400 bg-amber-500/10 border border-amber-700/50 rounded px-3 py-2">{message}</div>
                )}
              </div>
            </div>
            <div className="bg-[#131b2c] rounded-lg border border-[#1f2b3e] p-3">
              <ResponsiveContainer width="100%" height={90}>
                <BarChart data={chartData} margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#64748b' }} tickFormatter={(d) => d.slice(5)} minTickGap={20} />
                  <YAxis tick={{ fontSize: 10, fill: '#64748b' }} tickFormatter={(v) => (v / 1000) + 'k'} width={45} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="volume" isAnimationActive={false} shape={<VolumeBar />} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="bg-[#131b2c] rounded-lg border border-[#1f2b3e] p-3">
              <h2 className="text-xs font-semibold text-slate-400 mb-2">거래 내역</h2>
              <div className="max-h-40 overflow-y-auto">
                {tradeLog.length === 0 ? (
                  <p className="text-xs text-slate-500 py-2">아직 거래 내역이 없습니다.</p>
                ) : (
                  <table className="w-full text-xs font-mono">
                    <thead>
                      <tr className="text-slate-500 text-left border-b border-[#1f2b3e]">
                        <th className="py-1">날짜</th><th>구분</th><th>방식</th><th className="text-right">수량</th><th className="text-right">가격</th><th className="text-right">금액</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tradeLog.slice().reverse().map((t, i) => (
                        <tr key={i} className="border-b border-[#1f2b3e]/50">
                          <td className="py-1">{t.date}</td>
                          <td className={t.action === 'BUY' ? 'text-red-400' : t.action === 'SELL' ? 'text-blue-400' : 'text-slate-500'}>
                            {t.action === 'BUY' ? '매수' : t.action === 'SELL' ? '매도' : '취소'}
                          </td>
                          <td className="text-slate-500">{t.orderType}</td>
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
          <div className="space-y-3">
            <div className="bg-[#131b2c] rounded-lg border border-[#1f2b3e] p-3 space-y-1.5 text-sm font-mono">
              {[['현금', fmt(cash) + '원'],['보유 수량', shares.toLocaleString() + '주'],['평단가', shares > 0 ? fmt(avgCost) + '원' : '-'],['현재가', fmt(today.close) + '원']].map(([label, val]) => (
                <div key={label} className="flex justify-between"><span className="text-slate-500">{label}</span><span>{val}</span></div>
              ))}
              {shares > 0 && (
                <>
                  <div className="h-px bg-[#1f2b3e] my-1"></div>
                  <div className="flex justify-between">
                    <span className="text-slate-500" title="지금 보유 중인 주식을 살 때 들어간 총 매수금액">매수금액</span>
                    <span>{fmt(costBasis)}원</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500" title="매수금액 대비 현재 평가손익률 (매도 전 실시간 참고용)">포지션 수익률</span>
                    <span className={positionReturnPct >= 0 ? 'text-red-400' : 'text-blue-400'}>{positionReturnPct >= 0 ? '+' : ''}{positionReturnPct.toFixed(2)}%</span>
                  </div>
                </>
              )}
              <div className="h-px bg-[#1f2b3e] my-1"></div>
              <div className="flex justify-between font-semibold"><span className="text-slate-400">평가금액</span><span>{fmt(portfolioValue)}원</span></div>
              <div className="flex justify-between">
                <span className="text-slate-500" title="이번 차트로 전환된 시점부터 지금까지의 손익 (차트 새로고침 시 0%부터 다시 시작)">이번 차트 손익</span>
                <span className={chartPnl >= 0 ? 'text-red-400' : 'text-blue-400'}>{chartPnl >= 0 ? '+' : ''}{fmt(chartPnl)}원 ({chartReturnPct >= 0 ? '+' : ''}{chartReturnPct.toFixed(2)}%)</span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-slate-600" title="단순 경과일이 아니라, 이번 차트에서 매수해 전량 매도할 때까지의 실제 보유 기간 (거래일 / 달력일). 예약 매수는 실제로 체결된 날부터 카운트됩니다 — 주문을 등록만 한 상태에서는 0일로 표시됩니다.">└ 이번 차트 보유 기간</span>
                <span className="text-slate-500">
                  {currentChartHeldDays}거래일 · {currentChartHeldCalendarDays}일{positionOpenIdx !== null ? ' (진행 중)' : ''}
                  {positionOpenIdx === null && pendingOrders.some((o) => o.side === 'buy') ? ' (매수 예약 대기 중)' : ''}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500" title="게임을 초기화한 시점부터 지금까지, 여러 차트를 거치며 쌓인 전체 누적 손익">전체 게임 손익</span>
                <span className={gamePnl >= 0 ? 'text-red-400' : 'text-blue-400'}>{gamePnl >= 0 ? '+' : ''}{fmt(gamePnl)}원 ({returnPct >= 0 ? '+' : ''}{returnPct.toFixed(2)}%)</span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-slate-600" title="게임 시작 후 여러 차트를 거치며 실제로 주식을 보유하고 있던 기간의 총합 — 거래일(영업일) 기준과 달력일(주말 포함 실제 경과일) 기준 둘 다. 목표 수익 달성에 걸린 시간 역산용">└ 전체 보유 기간 합계</span>
                <span className="text-slate-500">{gameTotalHeldDays}거래일 · {gameTotalHeldCalendarDays}일</span>
              </div>
              {toppedUp > 0 && (
                <div className="flex justify-between text-[11px]">
                  <span className="text-slate-600">충전 누적 (게임 전체)</span>
                  <span className="text-slate-500">{fmt(toppedUp)}원</span>
                </div>
              )}
            </div>
            <div className="bg-[#131b2c] rounded-lg border border-[#1f2b3e] p-3">
              <h2 className="text-xs font-semibold text-slate-400 mb-2 flex items-center gap-1"><Clock size={12} /> 예약 주문</h2>
              {pendingOrders.length === 0 ? (
                <p className="text-xs text-slate-500">예약된 주문이 없습니다.</p>
              ) : (
                <div className="space-y-1.5">
                  {pendingOrders.map((o) => (
                    <div key={o.id} className="flex items-center justify-between bg-[#0d1320] rounded px-2 py-1.5 text-xs font-mono">
                      <span className={o.side === 'buy' ? 'text-red-400' : 'text-blue-400'}>
                        {o.side === 'buy' ? '매수' : '매도'} {o.qty}주 @ {fmt(o.price)}
                      </span>
                      <button onClick={() => cancelOrder(o.id)} className="text-slate-500 hover:text-slate-300"><X size={14} /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      {exportCsv && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50 overflow-y-auto" onClick={() => setExportCsv(null)}>
          <div className="bg-[#131b2c] border border-[#1f2b3e] rounded-lg w-full max-w-2xl max-h-[90vh] flex flex-col my-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#1f2b3e]">
              <div>
                <h2 className="text-sm font-semibold text-slate-200">학습 데이터 내보내기</h2>
                {exportRange && <p className="text-[11px] text-slate-500 mt-0.5">{exportRange.from} ~ {exportRange.to} ({exportRange.count}일치)</p>}
              </div>
              <button onClick={() => setExportCsv(null)} className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-[#2c3a4f] text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors">
                <X size={14} /> 닫기
              </button>
            </div>
            <textarea ref={exportTextareaRef} readOnly value={exportCsv} onFocus={(e) => e.target.select()}
              className="flex-1 m-3 bg-[#0d1320] border border-[#2c3a4f] rounded p-2 text-[11px] font-mono text-slate-300 outline-none resize-none min-h-[200px]" />
            <div className="flex gap-2 px-3 pb-3">
              <button onClick={downloadExportCsv} className="flex-1 flex items-center justify-center gap-1 bg-emerald-600/20 border border-emerald-700 text-emerald-400 rounded py-2 text-sm font-semibold hover:bg-emerald-600/30 transition-colors">
                <Download size={14} /> CSV 다운로드
              </button>
              <button onClick={copyExportCsv} className="flex-1 text-sm py-2 rounded border border-[#2c3a4f] text-slate-300 hover:border-slate-500 transition-colors">
                클립보드에 복사
              </button>
            </div>
            <p className="text-[10px] text-slate-500 px-3 pb-3">다운로드가 안 되면 텍스트 영역을 클릭(전체 선택) 후 복사하거나, 클립보드 복사 버튼을 사용하세요.</p>
            <div className="px-3 pb-3">
              <button onClick={() => setExportCsv(null)} className="w-full text-sm py-2 rounded border border-[#2c3a4f] text-slate-300 hover:border-slate-500 transition-colors">
                닫고 시뮬레이터로 돌아가기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
