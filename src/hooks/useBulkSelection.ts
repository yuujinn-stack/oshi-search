'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export function useBulkSelection(orderedIds: string[]) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isDragging, setIsDragging] = useState(false);

  // refs: no stale closure issues, no re-renders
  const orderedIdsRef = useRef(orderedIds);
  orderedIdsRef.current = orderedIds;

  const isDraggingRef = useRef(false);
  const dragModeRef = useRef<'add' | 'remove'>('add');
  const lastClickedIdRef = useRef<string | null>(null);

  useEffect(() => {
    const onMouseUp = () => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false;
        setIsDragging(false);
      }
    };
    document.addEventListener('mouseup', onMouseUp);
    return () => document.removeEventListener('mouseup', onMouseUp);
  }, []);

  const handleCardMouseDown = useCallback((id: string, e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('button, input, a, select, textarea')) return;
    e.preventDefault();

    if (e.shiftKey && lastClickedIdRef.current) {
      const ids = orderedIdsRef.current;
      const startIdx = ids.indexOf(lastClickedIdRef.current);
      const endIdx = ids.indexOf(id);
      if (startIdx !== -1 && endIdx !== -1) {
        const [lo, hi] = startIdx <= endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
        const range = ids.slice(lo, hi + 1);
        setSelectedIds((prev) => {
          const next = new Set(prev);
          for (const rid of range) next.add(rid);
          return next;
        });
        lastClickedIdRef.current = id;
        return;
      }
    }

    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        dragModeRef.current = 'remove';
      } else {
        next.add(id);
        dragModeRef.current = 'add';
      }
      return next;
    });
    lastClickedIdRef.current = id;
    isDraggingRef.current = true;
    setIsDragging(true);
  }, []);

  const handleCardMouseEnter = useCallback((id: string) => {
    if (!isDraggingRef.current) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (dragModeRef.current === 'add') next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    const ids = orderedIdsRef.current;
    setSelectedIds((prev) => {
      const allSelected = ids.length > 0 && ids.every((id) => prev.has(id));
      return allSelected ? new Set<string>() : new Set(ids);
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    lastClickedIdRef.current = null;
  }, []);

  return {
    selectedIds,
    isDragging,
    handleCardMouseDown,
    handleCardMouseEnter,
    toggleSelectAll,
    clearSelection,
  };
}
