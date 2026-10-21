import type { VoiceChat } from './useVoiceChat';

/** Botões da chamada na barra da sala. */
export function VoiceControls({ voice }: { voice: VoiceChat }) {
  const { status, notice, selfMuted, needsAudioUnlock } = voice;

  return (
    <span className="voice">
      {(status === 'idle' || status === 'error') && (
        <button onClick={voice.join} title="Conversar por voz com quem está na sala">
          🎧 Entrar na chamada
        </button>
      )}
      {status === 'connecting' && <button disabled>Conectando…</button>}
      {status === 'connected' && (
        <>
          <button
            onClick={voice.toggleMute}
            className={selfMuted ? 'muted' : ''}
            title={selfMuted ? 'Ligar o microfone' : 'Ficar mudo'}
          >
            {selfMuted ? '🔇 Mudo' : '🎤 Falando'}
          </button>
          {needsAudioUnlock && <button onClick={voice.unlockAudio}>🔊 Ativar som</button>}
          <button onClick={voice.leave} title="Sair da chamada (continua no jogo)">
            Sair da chamada
          </button>
        </>
      )}
      {status === 'unavailable' && (
        <span className="voice-off" title="Servidor sem LiveKit configurado">
          Chamada indisponível
        </span>
      )}
      {notice && <span className="voice-notice">{notice}</span>}
    </span>
  );
}
