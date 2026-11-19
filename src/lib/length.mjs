// Length buckets for the search filter (shared by the index builder, the search page and its script).
export const LENGTHS = [
  { id: 'short', name: 'Under 5k words', min: 0, max: 5000 },
  { id: 'mid', name: '5k to 20k words', min: 5000, max: 20000 },
  { id: 'long', name: 'Over 20k words', min: 20000, max: Infinity },
];
export function lengthBucket(words) {
  const w = Number(words) || 0;
  return (LENGTHS.find((l) => w >= l.min && w < l.max) || LENGTHS[0]).id;
}
