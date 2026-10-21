import { useEffect, useRef, type ReactNode } from 'react';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  /** Id do título, para o leitor de tela anunciar o diálogo pelo nome. */
  labelledBy: string;
  children: ReactNode;
}

/**
 * Modal com o <dialog> nativo: o navegador já prende o foco dentro, fecha com Esc e devolve o
 * foco ao botão que abriu. Clicar fora (no fundo escurecido) também fecha.
 */
export function Dialog({ open, onClose, labelledBy, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={labelledBy}
      onClose={onClose}
      // O clique no fundo chega no próprio <dialog>; cliques no conteúdo têm outro alvo.
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {open && <div className="dialog-body">{children}</div>}
    </dialog>
  );
}
