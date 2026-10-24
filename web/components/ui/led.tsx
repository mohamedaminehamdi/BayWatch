// The bay's virtual LED: the real one is pitch-only (no API), so the app mirrors it.
// Green = can be unlocked now; red = reserved soon or occupied. Lime stands in for green (the brand's
// "available"), ringed in ink because lime alone vanishes on paper. Always next to a word: never colour alone.
export function Led({ led, onDark = false, className = '' }: { led: 'green' | 'red'; onDark?: boolean; className?: string }) {
  const ring = onDark ? 'ring-on-brand/80' : 'ring-ink';
  return (
    <span
      role="img"
      aria-label={led === 'green' ? 'LED green: can be unlocked now' : 'LED red: reserved soon or occupied'}
      className={`inline-block size-2.5 shrink-0 rounded-full ring-2 ${ring} ${led === 'green' ? 'bg-signal' : 'bg-danger'} ${className}`}
    />
  );
}
