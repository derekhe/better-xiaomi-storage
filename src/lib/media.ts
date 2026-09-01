const videoExtensions = /\.(mp4|mov|mkv|avi|webm|m4v|3gp|mpg|mpeg|vob)$/i;

export function isVideoPath(path: string): boolean {
  return videoExtensions.test(path);
}
