import type { PostHog } from 'posthog-js';

/**
 * Atividade do site no PostHog (eventos, mapas de calor e gravação das sessões), só no site
 * publicado. Sem tela de aceite (a página de privacidade explica e tem como sair); o que se
 * digita fica mascarado, a chamada de voz e vídeo nunca é gravada (classe `ph-no-capture`) e a
 * conta é identificada pela id, nunca pelo e-mail. A biblioteca carrega depois da página, para não
 * atrasar o jogo; eventos de antes disso esperam numa fila.
 */

/** Chave do projeto: é pública (vai no navegador de qualquer jeito). */
const KEY = 'phc_ugHDeK8XJpiCTczhkEZCDmfGDYejPmKgG6Vaf8tSs6HQ';
const HOST = 'https://us.i.posthog.com';
/** "Não registrar minhas visitas" (página de privacidade): vale para este navegador. */
const OPT_OUT_KEY = 'quebra-cabeca:sem-registro';

let client: PostHog | undefined;
const pending: Array<(posthog: PostHog) => void> = [];

function optedOut(): boolean {
  try {
    return localStorage.getItem(OPT_OUT_KEY) === '1';
  } catch {
    return false;
  }
}

const enabled = () =>
  import.meta.env.PROD && !optedOut() && !['localhost', '127.0.0.1'].includes(location.hostname);

function run(action: (posthog: PostHog) => void): void {
  if (!enabled()) return;
  if (client) action(client);
  else pending.push(action);
}

/** Liga o PostHog (uma vez, depois que a página carregou). */
export function startAnalytics(): void {
  if (!enabled() || client) return;
  const load = () =>
    void import('posthog-js').then(({ default: posthog }) => {
      posthog.init(KEY, {
        api_host: HOST,
        ui_host: 'https://us.posthog.com',
        // o site troca de tela sem recarregar (convites, perfis): cada troca é uma página vista
        capture_pageview: 'history_change',
        // convidado continua anônimo; só quem entra com a conta vira uma pessoa no PostHog
        person_profiles: 'identified_only',
        session_recording: {
          maskAllInputs: true,
          // o tabuleiro e as câmeras são canvas e vídeo: pesados e (a chamada) privados
          captureCanvas: { recordCanvas: false },
        },
      });
      client = posthog;
      pending.splice(0).forEach((action) => action(posthog));
    });
  if (document.readyState === 'complete') load();
  else addEventListener('load', load, { once: true });
}

/** Um acontecimento do jogo, com detalhes (sem nada que a pessoa tenha digitado). */
export function track(event: string, properties?: Record<string, string | number | boolean>): void {
  run((posthog) => posthog.capture(event, properties));
}

/** Entrou com a conta: as próximas visitas ficam ligadas a ela (pela id, nunca o e-mail). */
export function identify(userId: string): void {
  run((posthog) => posthog.identify(userId));
}

/** Saiu da conta: daqui em diante, anônimo de novo. */
export function forget(): void {
  run((posthog) => posthog.reset());
}

export function isRecordingOptedOut(): boolean {
  return optedOut();
}

/** Liga ou desliga o registro neste navegador (a página de privacidade). */
export function setRecordingOptOut(out: boolean): void {
  try {
    if (out) localStorage.setItem(OPT_OUT_KEY, '1');
    else localStorage.removeItem(OPT_OUT_KEY);
  } catch {
    // sem storage: não dá para lembrar a escolha
  }
  if (out) client?.opt_out_capturing();
  else {
    client?.opt_in_capturing();
    startAnalytics();
  }
}
