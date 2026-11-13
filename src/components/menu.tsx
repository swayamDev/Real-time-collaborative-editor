"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

export interface MenuItem {
  label: string;
  onSelect: () => void;
  destructive?: boolean;
  /** Marks the current choice in a selection-style menu. */
  checked?: boolean;
  icon?: React.ReactNode;
}

type TriggerProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  ref: React.Ref<HTMLButtonElement>;
};

interface MenuProps {
  items: MenuItem[];
  /** Renders the trigger. Spread `props` onto a button. */
  trigger: (props: TriggerProps) => React.ReactNode;
  align?: "start" | "end";
  onOpenChange?: (open: boolean) => void;
}

/**
 * Accessible menu button. Uses fixed positioning so it is never clipped by a
 * scrolling container such as the sidebar list.
 */
export function Menu({ items, trigger, align = "end", onOpenChange }: MenuProps) {
  const [open, setOpenState] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();

  const setOpen = useCallback(
    (next: boolean) => {
      setOpenState(next);
      if (!next) setPosition(null);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );

  const close = useCallback(
    (restoreFocus: boolean) => {
      setOpen(false);
      if (restoreFocus) triggerRef.current?.focus();
    },
    [setOpen],
  );

  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !menuRef.current) return;
    const anchor = triggerRef.current.getBoundingClientRect();
    const menu = menuRef.current.getBoundingClientRect();
    const gap = 4;
    let top = anchor.bottom + gap;
    if (top + menu.height > window.innerHeight - 8) top = anchor.top - gap - menu.height;
    let left = align === "end" ? anchor.right - menu.width : anchor.left;
    left = Math.min(Math.max(8, left), window.innerWidth - menu.width - 8);
     
    setPosition({ top, left });
    const checkedIndex = items.findIndex((item) => item.checked);
    itemRefs.current[Math.max(0, checkedIndex)]?.focus();
  }, [open, align, items]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) close(false);
    };
    const onViewportChange = (event: Event) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      close(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
    };
  }, [open, close]);

  const onMenuKeyDown = (event: React.KeyboardEvent) => {
    const enabled = itemRefs.current.filter((item): item is HTMLButtonElement => item !== null);
    const index = enabled.indexOf(document.activeElement as HTMLButtonElement);
    const focusAt = (i: number) => enabled[(i + enabled.length) % enabled.length]?.focus();
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusAt(index + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusAt(index - 1);
        break;
      case "Home":
        event.preventDefault();
        focusAt(0);
        break;
      case "End":
        event.preventDefault();
        focusAt(enabled.length - 1);
        break;
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        close(true);
        break;
      case "Tab":
        close(false);
        break;
    }
  };

  return (
    <>
      {trigger({
        ref: triggerRef,
        "aria-haspopup": "menu",
        "aria-expanded": open,
        "aria-controls": open ? menuId : undefined,
        // Keep the editor selection when this menu lives in the toolbar.
        onMouseDown: (event) => event.preventDefault(),
        onClick: () => setOpen(!open),
        onKeyDown: (event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            setOpen(true);
          }
        },
      })}
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          onKeyDown={onMenuKeyDown}
          onMouseDown={(event) => event.preventDefault()}
          style={{
            top: position?.top ?? 0,
            left: position?.left ?? 0,
            visibility: position ? "visible" : "hidden",
          }}
          className="animate-menu-in fixed z-50 max-h-[min(24rem,calc(100dvh-16px))] min-w-40 overflow-y-auto rounded-md border border-hairline bg-raised p-1 text-ui-sm text-ink shadow-float"
        >
          {items.map((item, index) => (
            <button
              key={item.label}
              ref={(node) => {
                itemRefs.current[index] = node;
              }}
              type="button"
              role={item.checked === undefined ? "menuitem" : "menuitemradio"}
              aria-checked={item.checked}
              tabIndex={-1}
              onClick={() => {
                close(true);
                item.onSelect();
              }}
              className={cn(
                "flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left outline-none hover:bg-hover focus-visible:bg-hover",
                item.destructive && "text-madder",
                item.checked && "font-medium",
              )}
            >
              {item.icon}
              <span className="flex-1">{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
