import { Google, decodeIdToken, generateCodeVerifier, generateState } from 'arctic';
import type { GoogleProfile } from './accounts';

/**
 * Login com Google (OAuth 2.0 com PKCE). Interface pequena para os testes trocarem por um falso,
 * sem rede: quem usa só começa (URL do Google) e termina (perfil a partir do código).
 */
export interface GoogleAuth {
  start(): { url: URL; state: string; codeVerifier: string };
  finish(code: string, codeVerifier: string): Promise<GoogleProfile>;
}

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  /** URL pública do site (https://puzzl-us.onrender.com ou http://localhost:5173 em dev). */
  publicUrl: string;
}

/** O Google devolve o navegador aqui depois do login (precisa estar cadastrada no console). */
export const callbackUrl = (publicUrl: string) => `${publicUrl}/auth/google/callback`;

export function createGoogleAuth({ clientId, clientSecret, publicUrl }: GoogleConfig): GoogleAuth {
  const google = new Google(clientId, clientSecret, callbackUrl(publicUrl));
  return {
    start() {
      const state = generateState();
      const codeVerifier = generateCodeVerifier();
      // Só nome e foto (profile) e o e-mail, que serve apenas para reconhecer o admin.
      const url = google.createAuthorizationURL(state, codeVerifier, [
        'openid',
        'profile',
        'email',
      ]);
      return { url, state, codeVerifier };
    },

    async finish(code, codeVerifier) {
      const tokens = await google.validateAuthorizationCode(code, codeVerifier);
      // O id_token veio direto do Google por HTTPS, na troca do código: não precisa conferir a
      // assinatura de novo (é o que a especificação do OpenID permite neste fluxo).
      const claims = decodeIdToken(tokens.idToken()) as {
        sub: string;
        name?: string;
        given_name?: string;
        picture?: string;
        email?: string;
        email_verified?: boolean;
      };
      return {
        sub: claims.sub,
        name: claims.name ?? claims.given_name ?? 'Jogador',
        picture: claims.picture,
        email: claims.email,
        emailVerified: claims.email_verified,
      };
    },
  };
}

/** Lê as variáveis do .env; sem cliente/segredo do Google, o login fica desligado. */
export function googleConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): GoogleConfig | undefined {
  const { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret } = env;
  if (!clientId || !clientSecret) return undefined;
  const publicUrl = (env.PUBLIC_URL ?? 'http://localhost:5173').replace(/\/+$/, '');
  return { clientId, clientSecret, publicUrl };
}
