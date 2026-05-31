import { useState } from 'react';

export function useCommandPalette({ results, onNavigate, onClose }) {
  const [activeIdx, setActiveIdx] = useState(0);

  const activate = (item) => {
    if (!item) return;
    onNavigate?.(item.path);
    onClose?.();
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      activate(results[activeIdx]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose?.();
    }
  };

  return { activeIdx, setActiveIdx, activate, onKeyDown };
}
