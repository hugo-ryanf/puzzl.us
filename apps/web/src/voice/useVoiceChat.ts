import { useCallback, useEffect, useRef, useState } from 'react';
// Só tipos aqui (somem no build): o SDK em si é importado sob demanda em join().
import type { Room as Call, RemoteTrack, RemoteTrackPublication } from 'livekit-client';
import type { VoiceTokenResponse } from '@puzzle/shared';
import type { PuzzleRoom } from '../net/connection';

export type VoiceStatus = 'idle' | 'connecting' | 'connected' | 'unavailable' | 'error';

/** Quem está na chamada, mudo e falando agora. Identidade no LiveKit = sessionId do jogo. */
export interface VoicePeers {
  inCall: ReadonlySet<string>;
  muted: ReadonlySet<string>;
  speaking: ReadonlySet<string>;
}

export interface VoiceChat {
  status: VoiceStatus;
  /** Aviso para mostrar (erro ao conectar ou microfone bloqueado). */
  notice?: string;
  selfMuted: boolean;
  peers: VoicePeers;
  /** O navegador bloqueou o som até um clique (política de autoplay). */
  needsAudioUnlock: boolean;
  join: () => void;
  leave: () => void;
  toggleMute: () => void;
  unlockAudio: () => void;
}

const NO_PEERS: VoicePeers = { inCall: new Set(), muted: new Set(), speaking: new Set() };

function readPeers(call: Call): VoicePeers {
  const everyone = [call.localParticipant, ...call.remoteParticipants.values()];
  return {
    inCall: new Set(everyone.map((p) => p.identity)),
    muted: new Set(everyone.filter((p) => !p.isMicrophoneEnabled).map((p) => p.identity)),
    speaking: new Set(everyone.filter((p) => p.isSpeaking).map((p) => p.identity)),
  };
}

/**
 * Chamada de áudio da sala (LiveKit). Entrar é opcional e sempre por clique: o navegador só
 * libera microfone e reprodução de áudio depois de um gesto do usuário.
 */
export function useVoiceChat(room: PuzzleRoom): VoiceChat {
  const callRef = useRef<Call | null>(null);
  /** Evita duas chamadas se clicarem de novo enquanto o SDK ainda está baixando. */
  const joiningRef = useRef(false);
  const [status, setStatus] = useState<VoiceStatus>('idle');
  const [notice, setNotice] = useState<string>();
  const [selfMuted, setSelfMuted] = useState(false);
  const [peers, setPeers] = useState<VoicePeers>(NO_PEERS);
  const [needsAudioUnlock, setNeedsAudioUnlock] = useState(false);

  // Sair da sala (desmontar a tela) encerra a chamada.
  useEffect(
    () => () => {
      void callRef.current?.disconnect();
      callRef.current = null;
    },
    [],
  );

  const connect = useCallback(async () => {
    setStatus('connecting');
    setNotice(undefined);

    // 1) Token primeiro (barato): se o servidor está sem LiveKit, nem baixamos o SDK.
    // 2) SDK sob demanda: ~570 kB que só quem entra na chamada precisa baixar.
    let credentials: Extract<VoiceTokenResponse, { available: true }>;
    let sdk: typeof import('livekit-client');
    try {
      const response = (await room.request('voiceToken')) as VoiceTokenResponse;
      if (!response.available) {
        setStatus('unavailable');
        return;
      }
      credentials = response;
      sdk = await import('livekit-client');
    } catch (error) {
      setStatus('error');
      setNotice(`Não foi possível entrar na chamada: ${errorMessage(error)}`);
      return;
    }
    const { Room: Call, RoomEvent, Track } = sdk;

    const call = new Call({
      audioCaptureDefaults: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    callRef.current = call;
    const refresh = () => setPeers(readPeers(call));
    // Áudio de cada pessoa vira um <audio> invisível. Guardamos os elementos nós mesmos: ao
    // cancelar a inscrição o SDK já desliga o elemento antes do evento, então track.detach()
    // devolve [] e o <audio> ficaria esquecido na página (um a mais a cada entra-e-sai).
    const audioElements = new Map<string, HTMLMediaElement>();
    const removeAudio = (trackSid: string) => {
      audioElements.get(trackSid)?.remove();
      audioElements.delete(trackSid);
    };

    call
      .on(RoomEvent.TrackSubscribed, (track: RemoteTrack, publication: RemoteTrackPublication) => {
        if (track.kind === Track.Kind.Audio) {
          const element = track.attach();
          audioElements.set(publication.trackSid, element);
          document.body.appendChild(element);
        }
        refresh();
      })
      .on(
        RoomEvent.TrackUnsubscribed,
        (track: RemoteTrack, publication: RemoteTrackPublication) => {
          track.detach();
          removeAudio(publication.trackSid);
          refresh();
        },
      )
      .on(RoomEvent.ParticipantConnected, refresh)
      .on(RoomEvent.ParticipantDisconnected, refresh)
      .on(RoomEvent.TrackMuted, refresh)
      .on(RoomEvent.TrackUnmuted, refresh)
      .on(RoomEvent.LocalTrackPublished, refresh)
      .on(RoomEvent.ActiveSpeakersChanged, refresh)
      .on(RoomEvent.AudioPlaybackStatusChanged, () => setNeedsAudioUnlock(!call.canPlaybackAudio))
      .on(RoomEvent.Disconnected, () => {
        for (const trackSid of [...audioElements.keys()]) removeAudio(trackSid);
        if (callRef.current === call) callRef.current = null;
        setPeers(NO_PEERS);
        setNeedsAudioUnlock(false);
        setStatus((current) => (current === 'error' ? current : 'idle'));
      });

    try {
      await call.connect(credentials.url, credentials.token);
    } catch (error) {
      callRef.current = null;
      void call.disconnect();
      setStatus('error');
      setNotice(`Não foi possível entrar na chamada: ${errorMessage(error)}`);
      return;
    }

    // Microfone negado não derruba a chamada: a pessoa continua ouvindo os outros.
    try {
      await call.localParticipant.setMicrophoneEnabled(true);
      setSelfMuted(false);
    } catch {
      setSelfMuted(true);
      setNotice('Microfone bloqueado pelo navegador: você está só ouvindo.');
    }
    setNeedsAudioUnlock(!call.canPlaybackAudio);
    setStatus('connected');
    refresh();
  }, [room]);

  const join = useCallback(async () => {
    if (callRef.current || joiningRef.current) return;
    joiningRef.current = true;
    try {
      await connect();
    } finally {
      joiningRef.current = false;
    }
  }, [connect]);

  const leave = useCallback(() => {
    setNotice(undefined);
    void callRef.current?.disconnect();
  }, []);

  const toggleMute = useCallback(async () => {
    const call = callRef.current;
    if (!call) return;
    try {
      const enabled = !call.localParticipant.isMicrophoneEnabled;
      await call.localParticipant.setMicrophoneEnabled(enabled);
      setSelfMuted(!enabled);
      setNotice(undefined);
    } catch {
      setNotice('Microfone bloqueado pelo navegador: libere nas permissões do site.');
    }
    setPeers(readPeers(call));
  }, []);

  const unlockAudio = useCallback(async () => {
    await callRef.current?.startAudio();
    setNeedsAudioUnlock(false);
  }, []);

  return {
    status,
    notice,
    selfMuted,
    peers,
    needsAudioUnlock,
    join: () => void join(),
    leave,
    toggleMute: () => void toggleMute(),
    unlockAudio: () => void unlockAudio(),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
