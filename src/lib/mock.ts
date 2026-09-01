import type { Album, Photo } from '../types';

const urls = [
  'photo-1500530855697-b586d89ba3ee', 'photo-1507525428034-b723cf961d3e',
  'photo-1470770841072-f978cf4d019e', 'photo-1501785888041-af3ef285b470',
  'photo-1464822759023-fed622ff2c3b', 'photo-1500534314209-a25ddb2bd429',
  'photo-1441974231531-c6227db76b6e', 'photo-1519681393784-d120267933ba',
  'photo-1497436072909-f5e4be1713c0', 'photo-1518837695005-2083093ee35b',
  'photo-1470252649378-9c29740c9fa8', 'photo-1469474968028-56623f02e42e',
  'photo-1523712999610-f77fbcfc3843', 'photo-1470770903676-69b98201ea1c',
  'photo-1501854140801-50d01698950b', 'photo-1439853949127-fa647821eba0',
  'photo-1428908728789-d2de25dbd4e2', 'photo-1511497584788-876760111969',
  'photo-1470770841072-f978cf4d019e', 'photo-1472214103451-9374bd1c798e',
];

export const mockAlbums: Album[] = [
  { album_uuid: '1', name: '家庭时光', type: 'mock', photo_count: 1864, video_count: 42 },
  { album_uuid: '2', name: '旅行', type: 'mock', photo_count: 938, video_count: 18 },
  { album_uuid: '3', name: '宝宝', type: 'mock', photo_count: 521, video_count: 9 },
  { album_uuid: '4', name: '屏幕截图', type: 'mock', photo_count: 146, video_count: 0 },
];

export const mockPhotos: Photo[] = urls.map((id, index) => {
  const demoDate = index < 16
    ? new Date(Date.now() - index * 10_800_000)
    : new Date(2025 - (index - 16) * 3, 7 - (index - 16), 30 - index);
  return {
    member_id: `mock-${index}`,
    path: `/照片/IMG_20260${String(index + 1).padStart(2, '0')}.jpg`,
    size: String(2_400_000 + index * 73_000),
    modify_time: String(demoDate.getTime()),
    shot_time: String(demoDate.getTime()),
    location: index % 3 === 0 ? '云南省 大理市' : '',
    mockUrl: `https://images.unsplash.com/${id}?auto=format&fit=crop&w=900&q=82`,
  };
});
