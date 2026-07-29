import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

export interface RowAction {
  id: string;
  label: string;
  onSelect: () => void;
  tone?: 'danger';
  disabled?: boolean;
}

/**
 * Compact overflow menu for a table row.
 *
 * Row actions must not dictate row height: laying four buttons out vertically
 * makes every row as tall as the longest action list, which is mostly empty
 * space. One trigger keeps rows the height of their data and leaves room for
 * more actions later.
 */
export function RowActionsMenu({
  actions,
  label = '更多動作',
  align = 'right',
}: {
  actions: readonly RowAction[];
  label?: string;
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<'up' | 'down'>('down');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const initialFocusRef = useRef<'first' | 'last'>('first');
  const menuId = useId();

  const enabledIndices = actions.flatMap((action, index) => (action.disabled ? [] : [index]));
  const enabled = enabledIndices.length > 0;

  const focusEdge = (edge: 'first' | 'last') => {
    const index = edge === 'first' ? enabledIndices[0] : enabledIndices.at(-1);
    if (index !== undefined) itemRefs.current[index]?.focus();
  };

  const openMenu = (edge: 'first' | 'last' = 'first') => {
    initialFocusRef.current = edge;
    setOpen(true);
  };

  const closeMenu = (restoreTriggerFocus = false) => {
    setOpen(false);
    if (restoreTriggerFocus) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && rootRef.current?.contains(target)) return;
      closeMenu();
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeMenu(true);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [open]);

  useEffect(() => {
    if (open && !enabled) setOpen(false);
  }, [enabled, open]);

  useLayoutEffect(() => {
    if (!open) return;

    const updatePlacement = () => {
      const trigger = triggerRef.current;
      const menu = menuRef.current;
      if (!trigger || !menu) return;

      const triggerRect = trigger.getBoundingClientRect();
      const menuHeight = menu.getBoundingClientRect().height;
      const spaceBelow = window.innerHeight - triggerRect.bottom;
      const spaceAbove = triggerRect.top;
      setPlacement(menuHeight + 8 > spaceBelow && spaceAbove > spaceBelow ? 'up' : 'down');
    };

    updatePlacement();
    focusEdge(initialFocusRef.current);
    window.addEventListener('resize', updatePlacement);
    window.addEventListener('scroll', updatePlacement, true);
    return () => {
      window.removeEventListener('resize', updatePlacement);
      window.removeEventListener('scroll', updatePlacement, true);
    };
  }, [open]);

  const moveFocus = (direction: 1 | -1) => {
    if (enabledIndices.length === 0) return;
    const currentIndex = itemRefs.current.findIndex((item) => item === document.activeElement);
    const enabledPosition = enabledIndices.indexOf(currentIndex);
    const nextPosition =
      enabledPosition === -1
        ? direction === 1
          ? 0
          : enabledIndices.length - 1
        : (enabledPosition + direction + enabledIndices.length) % enabledIndices.length;
    const nextIndex = enabledIndices[nextPosition];
    if (nextIndex !== undefined) itemRefs.current[nextIndex]?.focus();
  };

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        disabled={!enabled}
        onClick={() => {
          if (open) {
            closeMenu();
          } else {
            openMenu();
          }
        }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
          event.preventDefault();
          openMenu(event.key === 'ArrowUp' ? 'last' : 'first');
        }}
        className="interactive-muted flex h-11 w-11 items-center justify-center rounded-lg text-lg leading-none disabled:opacity-40"
      >
        <span aria-hidden="true">⋯</span>
      </button>

      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          className={`absolute z-30 min-w-32 rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900 ${
            align === 'right' ? 'right-0' : 'left-0'
          } ${placement === 'up' ? 'bottom-full mb-1' : 'top-full mt-1'}`}
          onKeyDown={(event) => {
            switch (event.key) {
              case 'ArrowDown':
                event.preventDefault();
                moveFocus(1);
                break;
              case 'ArrowUp':
                event.preventDefault();
                moveFocus(-1);
                break;
              case 'Home':
                event.preventDefault();
                focusEdge('first');
                break;
              case 'End':
                event.preventDefault();
                focusEdge('last');
                break;
              case 'Tab':
                event.preventDefault();
                // Closing onto the trigger gives both Tab directions a stable
                // destination; the next keypress continues through the page.
                closeMenu(true);
                break;
            }
          }}
          onBlur={(event) => {
            const nextFocus = event.relatedTarget;
            if (!(nextFocus instanceof Node) || !rootRef.current?.contains(nextFocus)) {
              closeMenu();
            }
          }}
        >
          {actions.map((action, index) => (
            <button
              key={action.id}
              ref={(element) => {
                itemRefs.current[index] = element;
              }}
              type="button"
              role="menuitem"
              tabIndex={-1}
              disabled={action.disabled}
              onClick={() => {
                // Give dialogs a stable opener to restore on close. Edit forms
                // move focus to their first field after they mount.
                closeMenu(true);
                action.onSelect();
              }}
              className={`block min-h-[44px] w-full whitespace-nowrap px-3 py-2 text-left text-sm hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent disabled:opacity-40 dark:hover:bg-slate-800 ${
                action.tone === 'danger' ? 'text-danger' : ''
              }`}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
