export function waveformHeight(index: number, seed = "", min = 4, range = 32) {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  hash ^= Math.imul(index + 1, 2246822519);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 3266489917);
  hash ^= hash >>> 16;

  return min + ((hash >>> 0) / 4294967295) * range;
}
