'use client';

import { useEffect, useState } from 'react';

// Re-renders every second, for countdowns. Starts at 0 so server and first client render agree;
// screens only show times after their data loads, by which point the real clock is set.
export function useNow() {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export const formatCountdown = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// Client-only: locale formatting differs between server and browser
// 24-hour in every locale: drivers read "Held until 14:35", never "2:35 PM"
export const formatTime = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export const formatDay = (at: number) => new Date(at).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
