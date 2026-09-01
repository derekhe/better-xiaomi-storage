import { describe, expect, it } from 'vitest';
import { groupLabel, photoDate } from './date';

describe('photo dates', () => {
  it('parses seconds and milliseconds', () => {
    expect(photoDate({ shot_time: '1725100000', modify_time: '' }).getTime()).toBe(1_725_100_000_000);
    expect(photoDate({ shot_time: '1725100000000', modify_time: '' }).getTime()).toBe(1_725_100_000_000);
  });

  it('uses the modification time for the firmware sentinel value', () => {
    expect(photoDate({ shot_time: '3600000000', modify_time: '1725100000' }).getTime()).toBe(1_725_100_000_000);
  });

  it('labels today and yesterday', () => {
    const now = new Date(2026, 8, 1, 18, 0);
    expect(groupLabel(new Date(2026, 8, 1, 8, 0), now)).toBe('今天');
    expect(groupLabel(new Date(2026, 7, 31, 23, 0), now)).toBe('昨天');
  });
});
