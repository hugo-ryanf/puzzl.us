import express, { type Application } from 'express';
import { FriendCode, ProfileUpdate, type AccountView, type PublicProfile } from '@puzzle/shared';
import type { AccountStore } from '../auth/accounts';
import { accountFromCookieHeader } from '../auth/routes';
import type { ProfileStore } from './profile';

/**
 * PATCH /api/me/profile        → muda nickname, bio e avatar (logado); devolve a conta
 * GET   /api/profiles/:code    → perfil público pelo código de amigo (qualquer um vê)
 */
export function registerProfileRoutes(
  app: Application,
  accounts: AccountStore,
  profiles: ProfileStore,
) {
  app.patch('/api/me/profile', express.json(), async (req, res) => {
    const account = await accountFromCookieHeader(accounts, req.headers.cookie);
    if (!account) {
      res.status(401).json({ error: 'Entre com sua conta.' });
      return;
    }
    const update = ProfileUpdate.safeParse(req.body);
    if (!update.success) {
      res.status(400).json({ error: update.error.issues[0]?.message ?? 'Dados inválidos.' });
      return;
    }
    const body: AccountView = await accounts.updateProfile(account.id, update.data);
    res.json(body);
  });

  app.get('/api/profiles/:code', async (req, res) => {
    const code = FriendCode.safeParse(req.params.code);
    if (!code.success) {
      res.status(404).json({ error: 'Perfil não encontrado.' });
      return;
    }
    const viewer = await accountFromCookieHeader(accounts, req.headers.cookie);
    const profile: PublicProfile | undefined = await profiles.publicProfile(code.data, viewer?.id);
    if (!profile) {
      res.status(404).json({ error: 'Perfil não encontrado.' });
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json(profile);
  });
}
