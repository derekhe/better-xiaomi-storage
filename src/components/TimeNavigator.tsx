import { useEffect, useMemo, useState } from 'react';
import { CalendarRange, LoaderCircle, X } from 'lucide-react';
import { photoDate } from '../lib/date';
import type { Photo } from '../types';

interface TimeNavigatorProps {
  loading: boolean;
  message: string;
  photos: Photo[] | null;
  onClose(): void;
  onLocate(year: number, month: number, day: number): void;
}

export function TimeNavigator({ loading, message, photos, onClose, onLocate }: TimeNavigatorProps) {
  const years = useMemo(() => [...new Set((photos || []).map((photo) => photoDate(photo).getFullYear()))]
    .filter((year) => year > 1970)
    .sort((a, b) => b - a), [photos]);
  const [year, setYear] = useState(0);
  const [month, setMonth] = useState(0);
  const [day, setDay] = useState(0);

  useEffect(() => {
    if (years.length && !years.includes(year)) setYear(years[0]);
  }, [year, years]);

  const months = useMemo(() => [...new Set((photos || [])
    .filter((photo) => photoDate(photo).getFullYear() === year)
    .map((photo) => photoDate(photo).getMonth() + 1))]
    .sort((a, b) => b - a), [photos, year]);
  const days = useMemo(() => [...new Set((photos || [])
    .filter((photo) => {
      const date = photoDate(photo);
      return date.getFullYear() === year && (!month || date.getMonth() + 1 === month);
    })
    .map((photo) => photoDate(photo).getDate()))]
    .sort((a, b) => b - a), [month, photos, year]);

  useEffect(() => {
    if (month && !months.includes(month)) setMonth(0);
    if (day && !days.includes(day)) setDay(0);
  }, [day, days, month, months]);

  return (
    <div className="time-navigator" role="dialog" aria-label="按年月日定位">
      <div className="time-navigator-header">
        <div><CalendarRange size={18} /><strong>时间定位</strong></div>
        <button onClick={onClose} aria-label="关闭时间定位"><X size={17} /></button>
      </div>
      {loading ? (
        <div className="time-index-loading"><LoaderCircle className="spin" size={22} />正在建立完整时间索引…</div>
      ) : years.length ? (
        <>
          <label>年份</label>
          <div className="year-options">
            {years.map((value) => <button key={value} className={year === value ? 'active' : ''} onClick={() => { setYear(value); setMonth(0); setDay(0); }}>{value}</button>)}
          </div>
          <label>月份</label>
          <div className="month-options">
            <button className={month === 0 ? 'active' : ''} onClick={() => { setMonth(0); setDay(0); }}>全年</button>
            {months.map((value) => <button key={value} className={month === value ? 'active' : ''} onClick={() => { setMonth(value); setDay(0); }}>{value}月</button>)}
          </div>
          <label className="day-field">日期
            <select value={day} onChange={(event) => setDay(Number(event.target.value))}>
              <option value={0}>整月</option>
              {days.map((value) => <option key={value} value={value}>{value}日</option>)}
            </select>
          </label>
          <button className="locate-button" onClick={() => onLocate(year, month, day)}>定位到这里</button>
        </>
      ) : <div className="time-index-loading">{message || '当前相册没有可定位的照片'}</div>}
      {message && years.length ? <p className="time-message">{message}</p> : null}
    </div>
  );
}
