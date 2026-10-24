// License plate helpers. Matching tolerates the misreads cameras commonly make (dirt, glare, angle).

// "m-ab 1234" and "MAB1234" are the same plate
export const normalizePlate = (p: unknown) => String(p ?? '').toUpperCase().replace(/[^A-Z0-9ÄÖÜ]/g, '');

export const maskPlate = (p: string) => (p.length <= 4 ? '•••' : `${p.slice(0, 2)}•••${p.slice(-2)}`);

// Characters an OCR camera confuses, mapped to one canonical form
const CONFUSABLE: Record<string, string> = { O: '0', Q: '0', D: '0', I: '1', B: '8', S: '5', Z: '2', G: '6' };
const canonical = (p: string) => [...p].map((c) => CONFUSABLE[c] ?? c).join('');

// true if a and b differ by at most one substitution, insertion or deletion
function withinOneEdit(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

// How a camera read matches the booked plate, or null. Only ever compared against the one active
// booking, so a fuzzy match can't pick the wrong driver out of many.
export function samePlate(read: unknown, booked: unknown): 'exact' | 'fuzzy' | null {
  const a = normalizePlate(read);
  const b = normalizePlate(booked);
  if (!a || !b) return null;
  if (a === b) return 'exact';
  const ca = canonical(a);
  const cb = canonical(b);
  if (ca === cb) return 'fuzzy';
  // ponytail: one edit on 6+ characters also accepts a plate one digit off; fine for one bay with one booking
  return Math.min(ca.length, cb.length) >= 6 && withinOneEdit(ca, cb) ? 'fuzzy' : null;
}
