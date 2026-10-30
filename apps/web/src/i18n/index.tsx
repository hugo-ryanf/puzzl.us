import { Fragment, type ReactNode } from 'react';
import { en } from './en';

/**
 * Idioma do site. O português é a própria chave (`t('Criar sala')`) e `en.ts` traduz cada uma:
 * chave sem tradução não compila. O idioma é fixo durante a página (trocar recarrega), então
 * `t` também pode ser usado nas tabelas de constantes dos módulos.
 */
export type Locale = 'pt-BR' | 'en';
export type MessageKey = keyof typeof en;

/** Os `{nome}` de uma mensagem: faltar um valor em `t` também não compila. */
type Placeholders<S extends string> = S extends `${string}{${infer Name}}${infer Rest}`
  ? Name | Placeholders<Rest>
  : never;
type Params<K extends string, V> = [Placeholders<K>] extends [never]
  ? []
  : [Record<Placeholders<K>, V>];

const KEY = 'quebra-cabeca:idioma';

/** O escolhido neste navegador; sem escolha, português para quem usa em português. */
function detect(): Locale {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'pt-BR' || saved === 'en') return saved;
  } catch {
    // sem storage: decide pelo navegador
  }
  return navigator.language.toLowerCase().startsWith('pt') ? 'pt-BR' : 'en';
}

export const locale: Locale = detect();

const template = (key: MessageKey): string => (locale === 'en' ? en[key] : key);

/** Texto no idioma da pessoa: `t('{n} peças', { n: 48 })`. */
export function t<K extends MessageKey>(key: K, ...[params]: Params<K, string | number>): string {
  const values = params as Record<string, string | number> | undefined;
  return template(key).replace(/\{(\w+)\}/g, (_, name: string) => String(values?.[name]));
}

/** Como `t`, com elementos no meio do texto: `tRich('Olá, {name}', { name: <b>Ana</b> })`. */
export function tRich<K extends MessageKey>(key: K, ...[params]: Params<K, ReactNode>): ReactNode {
  const values = params as Record<string, ReactNode> | undefined;
  return template(key)
    .split(/\{(\w+)\}/)
    .map((part, index) =>
      index % 2 === 1 ? <Fragment key={index}>{values?.[part]}</Fragment> : part,
    );
}

/** Texto que vem de fora do código (fotos do catálogo): sem tradução, fica como está. */
export function translateOptional(text: string): string {
  return locale === 'en' ? ((en as Record<string, string>)[text] ?? text) : text;
}

/** Mensagens do servidor com valores no meio; ele sempre responde em português. */
const SERVER_PATTERNS: Array<[RegExp, (value: string) => string]> = [
  [
    /^Imagem pequena demais: o menor lado precisa ter (\d+) px\.$/,
    (n) => t('Imagem pequena demais: o menor lado precisa ter {n} px.', { n }),
  ],
  [/^a sala (\S+) já está aberta$/, (code) => t('a sala {code} já está aberta', { code })],
];

/** Traduz um erro do servidor; os desconhecidos aparecem como vieram. */
export function translateServerMessage(message: string): string {
  if (locale !== 'en') return message;
  for (const [pattern, translate] of SERVER_PATTERNS) {
    const value = pattern.exec(message)?.[1];
    if (value !== undefined) return translate(value);
  }
  return translateOptional(message);
}

/** 1000 → "1.000" em português, "1,000" em inglês. */
export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return value.toLocaleString(locale, options);
}

const ORDINAL_SUFFIXES: Partial<Record<Intl.LDMLPluralRule, string>> = {
  one: 'st',
  two: 'nd',
  few: 'rd',
  other: 'th',
};
const ordinalRules = new Intl.PluralRules('en', { type: 'ordinal' });

/** Posição no ranking: "3º" em português, "3rd" em inglês. */
export function ordinal(position: number): string {
  if (locale !== 'en') return `${position}º`;
  return `${position}${ORDINAL_SUFFIXES[ordinalRules.select(position)] ?? 'th'}`;
}

/** Guarda a escolha e recarrega: a sessão da sala e o login sobrevivem ao recarregar. */
export function setLocale(next: Locale): void {
  try {
    localStorage.setItem(KEY, next);
  } catch {
    return; // sem storage, a escolha não sobreviveria ao recarregar
  }
  location.reload();
}

document.documentElement.lang = locale;
document
  .querySelector('meta[name="description"]')
  ?.setAttribute(
    'content',
    t('Monte quebra-cabeças com amigos em tempo real, com chamada de voz e câmera.'),
  );
