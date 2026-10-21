import { useCallback, useEffect, useRef, useState } from 'react';
// Só tipos aqui (somem no build): o SDK em si é importado sob demanda em join().
import type {
  Room as Call,
  RemoteParticipant,
  RemoteTrack,
  RemoteTrackPublication,
  VideoTrack,
} from 'livekit-client';
import type { VoiceTokenResponse } from '@puzzle/shared';
import type { PuzzleRoom } from '../net/connection';

export type VoiceStatus = 'idle' | 'connecting' | 'connected' | 'unavailable' | 'error';

/** Quem está na chamada, mudo e falando agora. Identidade no LiveKit = sessionId do jogo. */
export interface VoicePeers {
  inCall: ReadonlySet<string>;
  muted: ReadonlySet<string>;
  speaking: ReadonlySet<string>;
  /** Câmera de cada um que está com ela ligada (inclusive a minha, para eu me ver). */
  video: ReadonlyMap<string, VideoTrack>;
}

export type DeviceKind = 'audioinput' | 'audiooutput' | 'videoinput';

export interface CallDevices {
  inputs: MediaDeviceInfo[];
  /** Vazio onde o navegador não deixa escolher a saída (ex.: Firefox, Safari). */
  outputs: MediaDeviceInfo[];
  /** O navegador só dá o nome das câmeras depois que a pessoa libera uma: até lá, vazio. */
  cameras: MediaDeviceInfo[];
  activeInput?: string;
  activeOutput?: string;
  activeCamera?: string;
}

export interface VoiceChat {
  status: VoiceStatus;
  /** Aviso para mostrar (erro ao conectar ou microfone bloqueado). */
  notice?: string;
  selfMuted: boolean;
  /** "Fone desligado": não ouço ninguém (o microfone continua como estava). */
  selfDeafened: boolean;
  selfCameraOn: boolean;
  peers: VoicePeers;
  /** O navegador bloqueou o som até um clique (política de autoplay). */
  needsAudioUnlock: boolean;
  devices: CallDevices;
  /** Tenta de novo, se a conexão automática falhou. */
  join: () => void;
  toggleMute: () => void;
  toggleDeafen: () => void;
  toggleCamera: () => void;
  unlockAudio: () => void;
  selectDevice: (kind: DeviceKind, deviceId: string) => void;
  /** Volume com que EU ouço essa pessoa (0–1). Só muda o meu lado da chamada. */
  peerVolume: (identity: string) => number;
  setPeerVolume: (identity: string, volume: number) => void;
  /** "Silenciar para mim": volume 0; de novo devolve o volume que estava antes. */
  togglePeerMuted: (identity: string) => void;
}

const NO_PEERS: VoicePeers = {
  inCall: new Set(),
  muted: new Set(),
  speaking: new Set(),
  video: new Map(),
};
const NO_DEVICES: CallDevices = { inputs: [], outputs: [], cameras: [] };

/**
 * Vídeo pequeno: na tela ele aparece num quadro 16:9 de 240 px de largura, então 384×216 a
 * 15 fps basta e gasta pouco da cota gratuita do LiveKit (e da internet de quem está no celular).
 */
const CAMERA_RESOLUTION = { width: 384, height: 216, frameRate: 15 };

async function readDevices(call: Call): Promise<CallDevices> {
  const all = await navigator.mediaDevices.enumerateDevices();
  // Sem permissão o navegador lista dispositivos sem nome; dentro da chamada já há permissão.
  const named = (kind: MediaDeviceKind) => all.filter((d) => d.kind === kind && d.label);
  const canChooseOutput = 'setSinkId' in HTMLMediaElement.prototype;
  return {
    inputs: named('audioinput'),
    outputs: canChooseOutput ? named('audiooutput') : [],
    cameras: named('videoinput'),
    activeInput: call.getActiveDevice('audioinput'),
    activeOutput: call.getActiveDevice('audiooutput'),
    activeCamera: call.getActiveDevice('videoinput'),
  };
}

function readPeers(call: Call): VoicePeers {
  const everyone = [call.localParticipant, ...call.remoteParticipants.values()];
  return {
    inCall: new Set(everyone.map((p) => p.identity)),
    muted: new Set(everyone.filter((p) => !p.isMicrophoneEnabled).map((p) => p.identity)),
    speaking: new Set(everyone.filter((p) => p.isSpeaking).map((p) => p.identity)),
    video: new Map(
      everyone.flatMap((p) => {
        // A única fonte de vídeo liberada no token é a câmera (sem compartilhar tela).
        const publication = [...p.videoTrackPublications.values()].find(
          (pub) => pub.videoTrack && !pub.isMuted,
        );
        return publication?.videoTrack ? [[p.identity, publication.videoTrack] as const] : [];
      }),
    ),
  };
}

/**
 * Chamada da sala (LiveKit): voz e, se a pessoa quiser, câmera. Quem entra na sala já entra na
 * chamada; para não falar ou não ouvir, desliga o microfone e/ou o som. Entrar na sala foi um clique, então o navegador
 * costuma liberar o áudio; se não liberar (ex.: depois de um F5), `needsAudioUnlock` avisa.
 */
export function useVoiceChat(room: PuzzleRoom, enabled = true): VoiceChat {
  const callRef = useRef<Call | null>(null);
  /** Evita duas chamadas se clicarem de novo enquanto o SDK ainda está baixando. */
  const joiningRef = useRef(false);
  /** A tela da sala ainda está aberta? Saiu no meio da conexão = não cria a chamada. */
  const mountedRef = useRef(false);
  const [status, setStatus] = useState<VoiceStatus>('idle');
  const [notice, setNotice] = useState<string>();
  const [selfMuted, setSelfMuted] = useState(false);
  const [selfDeafened, setSelfDeafened] = useState(false);
  const [selfCameraOn, setSelfCameraOn] = useState(false);
  // Em ref também: o evento de nova faixa de áudio (registrado uma vez) precisa do valor atual.
  const deafenedRef = useRef(false);
  const [peers, setPeers] = useState<VoicePeers>(NO_PEERS);
  const [needsAudioUnlock, setNeedsAudioUnlock] = useState(false);
  const [devices, setDevices] = useState<CallDevices>(NO_DEVICES);
  const [volumes, setVolumes] = useState<Record<string, number>>({});
  // Cópia em ref: os eventos do LiveKit (registrados uma vez) precisam do valor atual.
  const volumesRef = useRef(volumes);
  /** Volume de antes do "silenciar para mim", para devolver ao desfazer. */
  const beforeMuteRef = useRef<Record<string, number>>({});

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
    if (!mountedRef.current) return; // saiu da sala enquanto o SDK baixava
    const { Room: Call, RoomEvent, Track } = sdk;

    const call = new Call({
      audioCaptureDefaults: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      videoCaptureDefaults: { resolution: CAMERA_RESOLUTION },
      // Vídeo já é pequeno: uma camada só, sem simulcast.
      publishDefaults: { simulcast: false },
      // Só recebe vídeo de quem está visível na tela e no tamanho em que aparece.
      adaptiveStream: true,
      dynacast: true,
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

    const refreshDevices = () => void readDevices(call).then(setDevices);

    call
      .on(
        RoomEvent.TrackSubscribed,
        (
          track: RemoteTrack,
          publication: RemoteTrackPublication,
          participant: RemoteParticipant,
        ) => {
          if (track.kind === Track.Kind.Audio) {
            const element = track.attach();
            audioElements.set(publication.trackSid, element);
            document.body.appendChild(element);
            // Quem saiu e voltou da chamada continua com o volume que eu tinha escolhido.
            participant.setVolume(
              deafenedRef.current ? 0 : (volumesRef.current[participant.identity] ?? 1),
            );
          }
          refresh();
        },
      )
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
      .on(RoomEvent.LocalTrackUnpublished, refresh)
      .on(RoomEvent.TrackPublished, refresh)
      .on(RoomEvent.TrackUnpublished, refresh)
      .on(RoomEvent.ActiveSpeakersChanged, refresh)
      .on(RoomEvent.AudioPlaybackStatusChanged, () => setNeedsAudioUnlock(!call.canPlaybackAudio))
      // Plugou/desplugou um fone no meio da chamada, ou trocou o dispositivo ativo.
      .on(RoomEvent.MediaDevicesChanged, refreshDevices)
      .on(RoomEvent.ActiveDeviceChanged, refreshDevices)
      .on(RoomEvent.Disconnected, () => {
        for (const trackSid of [...audioElements.keys()]) removeAudio(trackSid);
        if (callRef.current === call) callRef.current = null;
        setPeers(NO_PEERS);
        setDevices(NO_DEVICES);
        setNeedsAudioUnlock(false);
        deafenedRef.current = false; // na próxima chamada, começa ouvindo de novo
        setSelfDeafened(false);
        setSelfCameraOn(false);
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
    refreshDevices();
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

  // Abrir a sala já entra na chamada (menos no solo); sair da sala (desmontar a tela) encerra.
  useEffect(() => {
    mountedRef.current = true;
    if (enabled) void join();
    return () => {
      mountedRef.current = false;
      void callRef.current?.disconnect();
      callRef.current = null;
    };
  }, [join, enabled]);

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

  /** Desliga/religa todo o som da chamada sem perder o volume escolhido para cada pessoa. */
  const toggleDeafen = useCallback(() => {
    const deafened = !deafenedRef.current;
    deafenedRef.current = deafened;
    setSelfDeafened(deafened);
    for (const participant of callRef.current?.remoteParticipants.values() ?? []) {
      participant.setVolume(deafened ? 0 : (volumesRef.current[participant.identity] ?? 1));
    }
  }, []);

  /** Câmera começa desligada: ligar é sempre escolha da pessoa (e pede permissão na hora). */
  const toggleCamera = useCallback(async () => {
    const call = callRef.current;
    if (!call) return;
    const enabled = !call.localParticipant.isCameraEnabled;
    try {
      await call.localParticipant.setCameraEnabled(enabled);
      setSelfCameraOn(enabled);
      setNotice(undefined);
    } catch {
      setSelfCameraOn(false);
      setNotice('Câmera bloqueada pelo navegador (ou em uso por outro programa).');
    }
    setPeers(readPeers(call));
    // Com a câmera liberada, o navegador passa a dar o nome das câmeras para a lista.
    setDevices(await readDevices(call));
  }, []);

  const unlockAudio = useCallback(async () => {
    await callRef.current?.startAudio();
    setNeedsAudioUnlock(false);
  }, []);

  const selectDevice = useCallback(async (kind: DeviceKind, deviceId: string) => {
    const call = callRef.current;
    if (!call) return;
    try {
      await call.switchActiveDevice(kind, deviceId);
      setNotice(undefined);
    } catch {
      setNotice('Não foi possível trocar o dispositivo.');
    }
    setDevices(await readDevices(call));
  }, []);

  const setPeerVolume = useCallback((identity: string, volume: number) => {
    const clamped = Math.min(1, Math.max(0, volume));
    volumesRef.current = { ...volumesRef.current, [identity]: clamped };
    setVolumes(volumesRef.current);
    // Com o fone desligado, o volume novo só vale quando religar.
    if (!deafenedRef.current) callRef.current?.remoteParticipants.get(identity)?.setVolume(clamped);
  }, []);

  const peerVolume = useCallback((identity: string) => volumes[identity] ?? 1, [volumes]);

  const togglePeerMuted = useCallback(
    (identity: string) => {
      const current = volumesRef.current[identity] ?? 1;
      if (current > 0) {
        beforeMuteRef.current[identity] = current;
        setPeerVolume(identity, 0);
      } else {
        setPeerVolume(identity, beforeMuteRef.current[identity] ?? 1);
      }
    },
    [setPeerVolume],
  );

  return {
    status,
    notice,
    selfMuted,
    selfDeafened,
    selfCameraOn,
    peers,
    needsAudioUnlock,
    devices,
    join: () => void join(),
    toggleMute: () => void toggleMute(),
    toggleDeafen,
    toggleCamera: () => void toggleCamera(),
    unlockAudio: () => void unlockAudio(),
    selectDevice: (kind, deviceId) => void selectDevice(kind, deviceId),
    peerVolume,
    setPeerVolume,
    togglePeerMuted,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
