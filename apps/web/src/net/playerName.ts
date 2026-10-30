import { t, translateServerMessage } from '../i18n';
const NAME_KEY = 'quebra-cabeca:nome';

// localStorage pode estar bloqueado; o nome lembrado é só conveniência.
export function loadPlayerName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function savePlayerName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // sem storage, a pessoa só digita de novo da próxima vez
  }
}

/** Mensagens do matchmaker/rede no idioma de quem joga. */
export function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/not found/i.test(message)) return t('Sala não encontrada. Confira o código.');
  if (/locked|full/i.test(message)) return t('Essa sala está cheia ou já terminou.');
  if (/fetch|network|ECONNREFUSED/i.test(message)) return t('Não consegui falar com o servidor.');
  return translateServerMessage(message);
}
