import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from '@colyseus/core';
import { createGameServer } from './app';

const PORT = 2569;
const base = `http://127.0.0.1:${PORT}`;
let server: Server;
let webDist: string;

// Um "site compilado" de mentira: o index.html e um arquivo com hash, como o Vite gera.
beforeAll(async () => {
  webDist = mkdtempSync(join(tmpdir(), 'quebra-cabeca-web-'));
  mkdirSync(join(webDist, 'assets'));
  writeFileSync(join(webDist, 'index.html'), '<!doctype html><title>Quebra-cabeça</title>');
  writeFileSync(join(webDist, 'assets', 'app-abc123.js'), 'console.log(1)');
  // Sem o boot() do @colyseus/testing: ele ignora a porta e usaria a 2568 dos outros testes.
  server = createGameServer({ webDist });
  await server.listen(PORT);
});
afterAll(async () => {
  await server.gracefullyShutdown(false);
  rmSync(webDist, { recursive: true, force: true });
});

describe('servidor entregando o site (produção)', () => {
  it('um convite (/CODIGO) abre o site, sem cache', async () => {
    const response = await fetch(`${base}/K7QF2`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('<title>Quebra-cabeça</title>');
    expect(response.headers.get('cache-control')).toBe('no-cache');
  });

  it('arquivos com hash ficam em cache para sempre', async () => {
    const response = await fetch(`${base}/assets/app-abc123.js`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('immutable');
  });

  it('a API continua respondendo, e rota inexistente da API dá 404 (não o site)', async () => {
    expect((await fetch(`${base}/api/health`)).status).toBe(200);
    const missing = await fetch(`${base}/api/nao-existe`);
    expect(missing.status).toBe(404);
    expect(await missing.text()).not.toContain('Quebra-cabeça');
  });
});
