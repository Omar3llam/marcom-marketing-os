import { useEffect, useRef, useState } from 'react';

export function useReveal() {
  const ref = useRef(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!ref.current || shown) return;
    const obs = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) setShown(true); }),
      { rootMargin: '0px 0px -10% 0px', threshold: 0.05 },
    );
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, [shown]);
  return [ref, shown];
}
