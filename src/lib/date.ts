import type { Photo } from '../types';

export function photoDate(photo: Pick<Photo, 'shot_time' | 'modify_time'>): Date {
  const raw = photo.shot_time === '3600000000' ? photo.modify_time : photo.shot_time || photo.modify_time;
  if (!raw) return new Date(0);
  if (/^\d+$/.test(raw)) {
    const number = Number(raw);
    if (number > 10_000_000_000_000) return new Date(Math.floor(number / 1000));
    if (number > 10_000_000_000) return new Date(number);
    return new Date(number * 1000);
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;
}

export function groupLabel(date: Date, now = new Date()): string {
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const delta = Math.round((today - day) / 86_400_000);
  if (delta === 0) return '今天';
  if (delta === 1) return '昨天';
  if (date.getFullYear() === now.getFullYear()) return `${date.getMonth() + 1}月${date.getDate()}日`;
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

export function groupPhotos(photos: Photo[]): Array<{ label: string; photos: Photo[]; date: Date }> {
  const groups = new Map<string, { label: string; photos: Photo[]; date: Date }>();
  for (const photo of photos) {
    const date = photoDate(photo);
    const label = groupLabel(date);
    const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    const group = groups.get(key) || { label, photos: [], date };
    group.photos.push(photo);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.date.getTime() - a.date.getTime());
}

export function formatDateTime(photo: Photo): string {
  const date = photoDate(photo);
  if (!date.getTime()) return '未知日期';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}
