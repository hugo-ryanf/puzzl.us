import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

interface PopoverProps {
  /** Nome acessível do painel (e do botão, se `triggerLabel` não for dado). */
  label: string;
  triggerLabel?: string;
  triggerClassName?: string;
  trigger: ReactNode;
  /** Lado em que o painel se alinha ao botão. */
  align?: 'start' | 'end';
  /** Abre também ao passar o mouse (o clique "fixa" o painel aberto). */
  openOnHover?: boolean;
  children: ReactNode;
}

/** Atraso para o painel não piscar ao passar o mouse rapidamente por cima. */
const HOVER_DELAY_MS = 120;

/**
 * Painel ancorado num botão: abre no clique (e, opcionalmente, ao passar o mouse); fecha com Esc,
 * clicando fora ou saindo com o mouse quando foi aberto pelo hover.
 */
export function Popover({
  label,
  triggerLabel,
  triggerClassName,
  trigger,
  align = 'end',
  openOnHover = false,
  children,
}: PopoverProps) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const panelId = useId();

  const close = () => {
    setOpen(false);
    setPinned(false);
  };

  // Clique fora fecha; Esc fecha e devolve o foco ao botão.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!anchorRef.current?.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      close();
      buttonRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  useEffect(() => () => clearTimeout(hoverTimer.current), []);

  const hover = (entering: boolean) => {
    if (!openOnHover || pinned) return;
    clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setOpen(entering), HOVER_DELAY_MS);
  };

  return (
    <span
      ref={anchorRef}
      className="popover-anchor"
      onMouseEnter={() => hover(true)}
      onMouseLeave={() => hover(false)}
    >
      <button
        ref={buttonRef}
        type="button"
        className={triggerClassName}
        aria-label={triggerLabel ?? label}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => {
          clearTimeout(hoverTimer.current);
          // Clique num painel aberto pelo hover só o fixa; clique num painel fixo fecha.
          if (open && pinned) close();
          else {
            setOpen(true);
            setPinned(true);
          }
        }}
      >
        {trigger}
      </button>
      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label={label}
          className={align === 'end' ? 'popover align-end' : 'popover'}
        >
          {children}
        </div>
      )}
    </span>
  );
}
