import express, { type Application, type CookieOptions, type Response } from 'express';
import { LinkGuestRequest, type MeResponse } from '@puzzle/shared';
import type { AccountStore } from './accounts';
import type { GoogleAuth } from './google';

export const SESSION_COOKIE = 'sid';
const STATE_COOKIE = 'oauth_state';
const VERIFIER_COOKIE = 'oauth_verifier';
/** Tempo para a pessoa concluir a tela do Google. */
const LOGIN_WINDOW_MS = 10 * 60 * 1000;

export interface AuthOptions {
  accounts: AccountStore;
  /** Sem ele (GOOGLE_* fora do .env), o botão de entrar some e o jogo segue só com convidados. */
  google?: GoogleAuth;
  /** Para onde o navegador volta depois do login. */
  publicUrl: string;
  /** E-mails (minúsculos) que ganham `is_admin` ao entrar. */
  adminEmails: string[];
  /** Em produção (HTTPS), cookies só trafegam cifrados. Em http://localhost, não dá. */
  secureCookies: boolean;
}

/** "a=1; sid=abc" → { a: '1', sid: 'abc' }. Express não lê cookie sem o cookie-parser. */
export function parseCookies(header: string | null | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of header?.split(';') ?? []) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      cookies[name] = value;
    }
  }
  return cookies;
}

/** A conta da sessão do cookie, se houver (usado pelas rotas e pela sala). */
export async function accountFromCookieHeader(
  accounts: AccountStore | undefined,
  header: string | null | undefined,
) {
  const token = parseCookies(header)[SESSION_COOKIE];
  return token && accounts ? accounts.accountForSession(token) : undefined;
}

/**
 * GET  /auth/google            → vai para a tela do Google
 * GET  /auth/google/callback   → volta do Google, cria a sessão e devolve ao site
 * POST /auth/logout            → apaga a sessão
 * GET  /api/me                 → { user, googleLogin }
 * POST /api/me/link-guest      → { guestId }: passa o histórico do convidado para a conta
 *
 * Cookies httpOnly e SameSite=Lax: o JavaScript da página não os lê, e outros sites não
 * conseguem disparar um POST com a sessão de quem está logado.
 */
export function registerAuthRoutes(app: Application, options: AuthOptions) {
  const { accounts, google, publicUrl, adminEmails, secureCookies } = options;
  const base: CookieOptions = { httpOnly: true, sameSite: 'lax', secure: secureCookies, path: '/' };
  const backToSite = (res: Response, login: string) => res.redirect(`${publicUrl}/?login=${login}`);

  app.get('/auth/google', (_req, res) => {
    if (!google) return backToSite(res, 'indisponivel');
    const { url, state, codeVerifier } = google.start();
    const temporary = { ...base, maxAge: LOGIN_WINDOW_MS };
    res.cookie(STATE_COOKIE, state, temporary);
    res.cookie(VERIFIER_COOKIE, codeVerifier, temporary);
    res.redirect(url.toString());
  });

  app.get('/auth/google/callback', async (req, res) => {
    const cookies = parseCookies(req.headers.cookie);
    res.clearCookie(STATE_COOKIE, base);
    res.clearCookie(VERIFIER_COOKIE, base);
    if (!google) return backToSite(res, 'indisponivel');
    if (req.query.error) return backToSite(res, 'cancelado'); // a pessoa desistiu na tela do Google

    const { code, state } = req.query;
    const verifier = cookies[VERIFIER_COOKIE];
    // O state precisa ser o mesmo que mandamos: impede que um site jogue o login de outra pessoa.
    if (typeof code !== 'string' || !state || state !== cookies[STATE_COOKIE] || !verifier) {
      return backToSite(res, 'erro');
    }
    try {
      const profile = await google.finish(code, verifier);
      const email = profile.email?.toLowerCase();
      const isAdmin = !!email && profile.emailVerified === true && adminEmails.includes(email);
      const account = await accounts.signInWithGoogle(profile, isAdmin);
      const { token, expiresAt } = await accounts.createSession(account.id);
      res.cookie(SESSION_COOKIE, token, { ...base, expires: expiresAt });
      backToSite(res, 'ok');
    } catch (error) {
      console.error('[auth] falha no login com Google', error);
      backToSite(res, 'erro');
    }
  });

  app.post('/auth/logout', async (req, res) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token) await accounts.deleteSession(token);
    res.clearCookie(SESSION_COOKIE, base);
    res.sendStatus(204);
  });

  app.get('/api/me', async (req, res) => {
    const account = await accountFromCookieHeader(accounts, req.headers.cookie);
    const body: MeResponse = { user: account ?? null, googleLogin: !!google };
    res.setHeader('Cache-Control', 'no-store'); // muda ao entrar/sair: nunca de cache
    res.json(body);
  });

  app.post('/api/me/link-guest', express.json(), async (req, res) => {
    const account = await accountFromCookieHeader(accounts, req.headers.cookie);
    if (!account) {
      res.status(401).json({ error: 'Entre com sua conta.' });
      return;
    }
    const body = LinkGuestRequest.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: 'guestId inválido' });
      return;
    }
    await accounts.linkGuest(account.id, body.data.guestId);
    res.sendStatus(204);
  });
}
