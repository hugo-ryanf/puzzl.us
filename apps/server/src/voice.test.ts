import { describe, expect, it } from 'vitest';
import { TokenVerifier } from 'livekit-server-sdk';
import { createVoiceTokenIssuer, voiceConfigFromEnv, voiceRoomName } from './voice';

const config = {
  url: 'wss://teste.livekit.cloud',
  apiKey: 'chave-de-teste',
  apiSecret: 'segredo-de-teste-com-pelo-menos-32-caracteres',
};

describe('createVoiceTokenIssuer', () => {
  it('assina um token válido só para a chamada da sala, com a identidade do jogador', async () => {
    const issuer = createVoiceTokenIssuer(config);
    const { url, token } = await issuer.issue({
      roomId: 'K7QF2',
      identity: 'sessao-1',
      name: 'Ana',
    });

    expect(url).toBe(config.url);
    const claims = await new TokenVerifier(config.apiKey, config.apiSecret).verify(token);
    expect(claims.sub).toBe('sessao-1');
    expect(claims.name).toBe('Ana');
    expect(claims.video).toMatchObject({
      roomJoin: true,
      room: voiceRoomName('K7QF2'),
      canPublish: true,
      canSubscribe: true,
      canPublishData: false,
    });
  });

  it('o token não vale com outro segredo', async () => {
    const { token } = await createVoiceTokenIssuer(config).issue({
      roomId: 'K7QF2',
      identity: 'sessao-1',
      name: 'Ana',
    });
    const otherSecret = new TokenVerifier(
      config.apiKey,
      'outro-segredo-com-pelo-menos-32-caracteres',
    );
    await expect(otherSecret.verify(token)).rejects.toThrow();
  });
});

describe('voiceConfigFromEnv', () => {
  it('só liga a chamada com as três variáveis', () => {
    const full = {
      LIVEKIT_URL: config.url,
      LIVEKIT_API_KEY: config.apiKey,
      LIVEKIT_API_SECRET: config.apiSecret,
    };
    expect(voiceConfigFromEnv(full)).toEqual(config);
    expect(voiceConfigFromEnv({ ...full, LIVEKIT_API_SECRET: '' })).toBeUndefined();
    expect(voiceConfigFromEnv({})).toBeUndefined();
  });
});
