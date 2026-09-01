import { describe, expect, it } from 'vitest';
import { isVideoPath } from './media';

describe('media type detection', () => {
  it('recognizes supported video extensions without case sensitivity', () => {
    expect(isVideoPath('/相册/VID_001.MP4')).toBe(true);
    expect(isVideoPath('/相册/clip.mov')).toBe(true);
    expect(isVideoPath('/相册/old-video.3gp')).toBe(true);
    expect(isVideoPath('/相册/photo.jpg')).toBe(false);
  });
});
