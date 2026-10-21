import { useId } from 'react';
import {
  ChevronDownIcon,
  HeadphonesIcon,
  HeadphonesOffIcon,
  MicIcon,
  MicOffIcon,
  VideoIcon,
  VideoOffIcon,
  VolumeIcon,
} from '../ui/icons';
import { Popover } from '../ui/Popover';
import type { DeviceKind, VoiceChat } from './useVoiceChat';

/**
 * Suas opções de som na barra superior: microfone e fone (liga/desliga), cada um com uma seta
 * ao lado para escolher o dispositivo. A chamada começa sozinha ao entrar na sala.
 */
export function VoiceMenu({ voice }: { voice: VoiceChat }) {
  const { status, notice, selfMuted, selfDeafened, selfCameraOn, needsAudioUnlock, devices } =
    voice;

  // Fora da chamada (conectando, servidor sem LiveKit ou falhou): só o microfone, que tenta de novo.
  if (status !== 'connected') {
    const label =
      status === 'connecting'
        ? 'Conectando à chamada…'
        : status === 'unavailable'
          ? 'Chamada de voz indisponível neste servidor'
          : (notice ?? 'Não foi possível entrar na chamada') + ' — clique para tentar de novo';
    return (
      <button
        type="button"
        className={status === 'connecting' ? 'btn icon-btn' : 'btn icon-btn muted'}
        disabled={status === 'connecting' || status === 'unavailable'}
        aria-label={label}
        title={label}
        onClick={voice.join}
      >
        {status === 'connecting' ? <MicIcon size={18} /> : <MicOffIcon size={18} />}
      </button>
    );
  }

  // Só ícones: o nome de cada botão está no aria-label e aparece no title ao passar o mouse.
  return (
    <span className="voice">
      {needsAudioUnlock && (
        <button type="button" className="btn" onClick={voice.unlockAudio}>
          <VolumeIcon size={18} />
          Ativar som
        </button>
      )}
      <span className="split">
        <button
          type="button"
          className={selfMuted ? 'btn icon-btn muted' : 'btn icon-btn'}
          aria-label={selfMuted ? 'Ligar o microfone' : 'Desligar o microfone'}
          title={notice ?? (selfMuted ? 'Ligar o microfone' : 'Desligar o microfone')}
          onClick={voice.toggleMute}
        >
          {selfMuted ? <MicOffIcon size={18} /> : <MicIcon size={18} />}
        </button>
        <Popover
          label="Escolher microfone"
          triggerClassName="btn"
          trigger={<ChevronDownIcon size={16} />}
        >
          <DeviceList
            title="Microfone"
            kind="audioinput"
            options={devices.inputs}
            active={devices.activeInput}
            onSelect={voice.selectDevice}
          />
          {notice && <p className="popover-note">{notice}</p>}
        </Popover>
      </span>
      <span className="split">
        <button
          type="button"
          className={selfDeafened ? 'btn icon-btn muted' : 'btn icon-btn'}
          aria-label={selfDeafened ? 'Ligar o som da chamada' : 'Desligar o som da chamada'}
          title={selfDeafened ? 'Ligar o som da chamada' : 'Desligar o som da chamada'}
          onClick={voice.toggleDeafen}
        >
          {selfDeafened ? <HeadphonesOffIcon size={18} /> : <HeadphonesIcon size={18} />}
        </button>
        <Popover
          label="Escolher saída de som"
          triggerClassName="btn"
          trigger={<ChevronDownIcon size={16} />}
        >
          {devices.outputs.length > 0 ? (
            <DeviceList
              title="Saída de som"
              kind="audiooutput"
              options={devices.outputs}
              active={devices.activeOutput}
              onSelect={voice.selectDevice}
            />
          ) : (
            // Firefox e Safari não deixam o site escolher a saída: vale a do sistema.
            <p className="popover-note">
              Este navegador não deixa escolher a saída de som: ele usa a do sistema.
            </p>
          )}
        </Popover>
      </span>
      <span className="split">
        <button
          type="button"
          className="btn icon-btn"
          aria-label={selfCameraOn ? 'Desligar a câmera' : 'Ligar a câmera'}
          title={selfCameraOn ? 'Desligar a câmera' : 'Ligar a câmera'}
          onClick={voice.toggleCamera}
        >
          {selfCameraOn ? <VideoIcon size={18} /> : <VideoOffIcon size={18} />}
        </button>
        <Popover
          label="Escolher câmera"
          triggerClassName="btn"
          trigger={<ChevronDownIcon size={16} />}
        >
          <DeviceList
            title="Câmera"
            kind="videoinput"
            options={devices.cameras}
            active={devices.activeCamera}
            onSelect={voice.selectDevice}
            emptyNote="Ligue a câmera uma vez para o navegador mostrar a lista."
          />
        </Popover>
      </span>
    </span>
  );
}

interface DeviceListProps {
  title: string;
  kind: DeviceKind;
  options: MediaDeviceInfo[];
  active?: string;
  onSelect: (kind: DeviceKind, deviceId: string) => void;
  emptyNote?: string;
}

/** Lista de dispositivos como botões de rádio nativos (setas do teclado funcionam). */
function DeviceList({
  title,
  kind,
  options,
  active,
  onSelect,
  emptyNote = 'Nenhum dispositivo encontrado.',
}: DeviceListProps) {
  const name = useId();
  return (
    <fieldset className="device-list">
      <legend>{title}</legend>
      {options.length === 0 && <p className="popover-note">{emptyNote}</p>}
      {options.map((device) => (
        // Nomes do Windows são enormes ("… (Tecnologia Intel® Smart Sound …)"): cortamos com "…"
        // e o nome inteiro aparece ao parar o mouse em cima.
        <label key={device.deviceId} className="device-option" title={device.label}>
          <input
            type="radio"
            name={name}
            checked={device.deviceId === active || (!active && device.deviceId === 'default')}
            onChange={() => onSelect(kind, device.deviceId)}
          />
          <span>{device.label}</span>
        </label>
      ))}
    </fieldset>
  );
}
