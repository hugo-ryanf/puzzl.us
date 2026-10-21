import { AccessToken } from 'livekit-server-sdk';

export interface VoiceConfig {
  /** wss://<projeto>.livekit.cloud — vai para o cliente junto com o token. */
  url: string;
  apiKey: string;
  apiSecret: string;
}

/** O que a sala precisa para liberar a chamada. Sem LiveKit configurado, a sala recebe undefined. */
export interface VoiceTokenIssuer {
  issue(input: { roomId: string; identity: string; name: string }): Promise<{
    url: string;
    token: string;
  }>;
}

/** Validade do token: só precisa durar até o jogador entrar; uma partida longa cabe com folga. */
const TOKEN_TTL = '4h';

export function createVoiceTokenIssuer({ url, apiKey, apiSecret }: VoiceConfig): VoiceTokenIssuer {
  return {
    async issue({ roomId, identity, name }) {
      const token = new AccessToken(apiKey, apiSecret, { identity, name, ttl: TOKEN_TTL });
      // Permissões mínimas: entrar só na chamada desta sala, falar e ouvir. Sem canal de dados.
      token.addGrant({
        roomJoin: true,
        room: voiceRoomName(roomId),
        canPublish: true,
        canSubscribe: true,
        canPublishData: false,
      });
      return { url, token: await token.toJwt() };
    },
  };
}

/** Prefixo para não misturar com outras coisas que você venha a ter no mesmo projeto LiveKit. */
export function voiceRoomName(roomId: string): string {
  return `quebra-cabeca-${roomId}`;
}

/** Lê as três variáveis do .env; se faltar qualquer uma, a chamada fica desligada. */
export function voiceConfigFromEnv(env: NodeJS.ProcessEnv = process.env): VoiceConfig | undefined {
  const { LIVEKIT_URL: url, LIVEKIT_API_KEY: apiKey, LIVEKIT_API_SECRET: apiSecret } = env;
  return url && apiKey && apiSecret ? { url, apiKey, apiSecret } : undefined;
}
