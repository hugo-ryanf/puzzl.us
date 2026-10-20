/**
 * Junta chamadas frequentes (pointermove dispara 60–120×/s) e executa no máximo uma a cada
 * `intervalMs`, sempre com os argumentos mais recentes. Assim a rede recebe ~20 msgs/s.
 */
export function throttle<A extends unknown[]>(intervalMs: number, fn: (...args: A) => void) {
  let lastRun = 0;
  let pending: A | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const run = () => {
    timer = undefined;
    if (!pending) return;
    const args = pending;
    pending = undefined;
    lastRun = performance.now();
    fn(...args);
  };

  return {
    call(...args: A) {
      pending = args;
      if (!timer) timer = setTimeout(run, Math.max(0, lastRun + intervalMs - performance.now()));
    },
    /** Descarta o envio pendente (ex.: ao soltar a peça, que manda a posição final no drop). */
    cancel() {
      pending = undefined;
      clearTimeout(timer);
      timer = undefined;
    },
  };
}
