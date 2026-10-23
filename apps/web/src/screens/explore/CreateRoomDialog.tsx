import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  BULLET_MINUTES,
  BULLET_PIECES,
  MAX_PLAYERS,
  PIECE_COUNT_PRESETS,
  RANDOM_IMAGE,
  gridForPieceCount,
} from '@puzzle/shared';
import {
  createBattleRoom,
  createBulletRoom,
  createRoom,
  type PuzzleRoom,
} from '../../net/connection';
import { friendlyError, savePlayerName } from '../../net/playerName';
import { uploadImage, type UploadedImage } from '../../net/uploads';
import { DIFFICULTY_NAMES, Pips, difficultyOf } from '../../ui/difficulty';
import { Dialog } from '../../ui/Dialog';
import {
  ArrowRightIcon,
  BoltIcon,
  CameraIcon,
  CheckIcon,
  CloseIcon,
  ShuffleIcon,
  SwordsIcon,
  TimerIcon,
  UserIcon,
  UsersIcon,
} from '../../ui/icons';

/** A imagem escolhida na grade do catálogo. */
export interface PuzzleChoice {
  imageId: string;
  title: string;
  subtitle: string;
  thumbUrl: string;
}

/**
 * De onde veio o pedido: uma foto do catálogo (clique no card) ou "custom" (o "Criar sala" da
 * barra lateral, que é o único jeito de jogar com uma foto própria). null = diálogo fechado.
 */
export type CreateRoomSource = PuzzleChoice | 'custom' | null;

interface CreateRoomDialogProps {
  source: CreateRoomSource;
  name: string;
  onNameChange: (name: string) => void;
  /** Logado: o nome é o nickname do perfil (só mostra, não edita). */
  nameLocked?: boolean;
  onClose: () => void;
  onCreated: (room: PuzzleRoom) => void;
}

type Mode = 'solo' | 'multi' | 'battle' | 'bullet';
type BattleFormat = '1v1' | '2v2';
const PLAYER_OPTIONS = Array.from({ length: MAX_PLAYERS - 1 }, (_, i) => i + 2); // 2, 3, 4
/** No Bullet dá para jogar sozinho também. */
const BULLET_PLAYER_OPTIONS = Array.from({ length: MAX_PLAYERS }, (_, i) => i + 1); // 1–4
/** 1000 → "1.000", como no resto do site. */
const formatCount = (count: number) => count.toLocaleString('pt-BR');

/**
 * Criar sala em duas colunas: à esquerda a foto (grande, só a imagem) com quantas peças vai
 * dar; à direita como jogar, tamanho e nome.
 */
export function CreateRoomDialog({
  source,
  name,
  onNameChange,
  nameLocked = false,
  onClose,
  onCreated,
}: CreateRoomDialogProps) {
  const custom = source === 'custom';
  const [mode, setMode] = useState<Mode>('solo');
  const [minutes, setMinutes] = useState<(typeof BULLET_MINUTES)[number]>(5);
  const [bulletPieces, setBulletPieces] = useState<(typeof BULLET_PIECES)[number]>(12);
  const [bulletPlayers, setBulletPlayers] = useState(1);
  const [format, setFormat] = useState<BattleFormat>('1v1');
  /** Batalha por tempo (quem monta mais) em vez de corrida (quem monta primeiro). */
  const [battleTimed, setBattleTimed] = useState(false);
  const [powers, setPowers] = useState(true);
  const [players, setPlayers] = useState(2);
  const [randomImage, setRandomImage] = useState(false);
  const [uploaded, setUploaded] = useState<UploadedImage>();
  const [pieceCount, setPieceCount] = useState(48);
  /** Proporção da foto, lida da imagem ao carregar (serve para catálogo e foto enviada). */
  const [aspect, setAspect] = useState(4 / 3);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  // A pré-visualização da foto enviada é um object URL: libera ao trocar de foto ou fechar.
  useEffect(() => {
    return () => {
      if (uploaded) URL.revokeObjectURL(uploaded.previewUrl);
    };
  }, [uploaded]);

  const bullet = mode === 'bullet';
  const timedBattle = mode === 'battle' && battleTimed;
  /** Bullet e batalha por tempo sorteiam as fotos: a escolhida não vale. */
  const drawn = bullet || timedBattle;
  const random = !custom && (mode === 'multi' || mode === 'battle') && randomImage;
  /** Sala personalizada sem foto (ou com a foto ainda subindo): não dá para começar. */
  const missingPhoto = custom && !uploaded && !drawn;
  const preview: PuzzleChoice | undefined = custom
    ? uploaded && {
        imageId: uploaded.imageId,
        title: 'Sua foto',
        subtitle: 'Sala personalizada · publique no fim para entrar no ranking',
        thumbUrl: uploaded.previewUrl,
      }
    : (source ?? undefined);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!source) return;
    const trimmed = name.trim();
    if (!trimmed) return setError('Digite seu nome.');
    if (bullet) {
      // Bullet não usa a foto escolhida: cada quebra-cabeça é sorteado do catálogo.
      savePlayerName(trimmed);
      setBusy(true);
      setError(undefined);
      try {
        onCreated(
          await createBulletRoom({
            name: trimmed,
            minutes,
            pieces: bulletPieces,
            maxPlayers: bulletPlayers,
          }),
        );
      } catch (e) {
        setError(friendlyError(e));
        setBusy(false);
      }
      return;
    }
    if (timedBattle) {
      savePlayerName(trimmed);
      setBusy(true);
      setError(undefined);
      try {
        onCreated(
          await createBattleRoom({
            name: trimmed,
            pieceCount: bulletPieces,
            imageId: RANDOM_IMAGE,
            format,
            minutes,
            powers,
          }),
        );
      } catch (e) {
        setError(friendlyError(e));
        setBusy(false);
      }
      return;
    }
    const imageId = random ? RANDOM_IMAGE : preview?.imageId;
    if (!imageId) return setError('Escolha a foto do quebra-cabeça.');
    savePlayerName(trimmed);
    setBusy(true);
    setError(undefined);
    try {
      if (mode === 'battle') {
        onCreated(await createBattleRoom({ name: trimmed, pieceCount, imageId, format, powers }));
        return;
      }
      const maxPlayers = mode === 'solo' ? 1 : players;
      onCreated(await createRoom({ name: trimmed, pieceCount, imageId, maxPlayers }));
    } catch (e) {
      setError(friendlyError(e));
      setBusy(false);
    }
  }

  const subtitle = bullet
    ? 'Monte o máximo de quebra-cabeças pequenos até o tempo acabar. As fotos são sorteadas.'
    : custom
      ? 'Envie uma foto sua e escolha como jogar.'
      : mode === 'solo'
        ? 'Escolha o tamanho e comece quando quiser.'
        : timedBattle
          ? 'Dois lados, as mesmas fotos sorteadas: quem montar mais até o tempo acabar ganha.'
          : mode === 'battle'
            ? 'Dois lados montam o mesmo quebra-cabeça: quem terminar primeiro ganha.'
            : 'Escolha o tamanho e chame seus amigos pelo link da sala.';

  /** Tempo e tamanho do Bullet (também na batalha por tempo). */
  const timeAndPieces = (
    <>
      <fieldset className="choice-row">
        <legend>Tempo</legend>
        {BULLET_MINUTES.map((value) => (
          <label key={value} className="radio-chip">
            <input
              type="radio"
              name="bullet-minutes"
              className="sr-only"
              checked={minutes === value}
              onChange={() => setMinutes(value)}
            />
            {value} min
          </label>
        ))}
      </fieldset>
      <fieldset className="choice-row">
        <legend>Peças</legend>
        {BULLET_PIECES.map((value) => (
          <label key={value} className="radio-chip">
            <input
              type="radio"
              name="bullet-pieces"
              className="sr-only"
              checked={bulletPieces === value}
              onChange={() => setBulletPieces(value)}
            />
            {value}
          </label>
        ))}
      </fieldset>
    </>
  );

  return (
    <Dialog
      open={source !== null}
      onClose={onClose}
      labelledBy="create-title"
      className="dialog-split"
    >
      {source && (
        <>
          <aside className="play-media">
            {drawn ? (
              <BulletPreview pieces={bulletPieces} />
            ) : custom && !preview ? (
              <PhotoUpload onUploaded={setUploaded} />
            ) : (
              <MediaPreview
                choice={random ? undefined : preview}
                aspect={aspect}
                onAspect={setAspect}
                pieceCount={pieceCount}
                onChangePhoto={custom ? () => setUploaded(undefined) : undefined}
              />
            )}
          </aside>

          <form className="play-form" onSubmit={handleSubmit}>
            <header className="play-header">
              <h2 id="create-title">{custom ? 'Sala personalizada' : 'Criar sala'}</h2>
              <p>{subtitle}</p>
            </header>

            {/* Rádios nativos escondidos: as setas do teclado trocam a opção, como em qualquer grupo. */}
            <fieldset className="mode-options">
              <legend>Como jogar</legend>
              <label className="mode-option">
                <input
                  type="radio"
                  name="mode"
                  className="sr-only"
                  checked={mode === 'solo'}
                  onChange={() => setMode('solo')}
                />
                <UserIcon size={20} />
                <strong>Solo</strong>
                <small>Só você. O relógio começa na hora.</small>
              </label>
              <label className="mode-option">
                <input
                  type="radio"
                  name="mode"
                  className="sr-only"
                  checked={mode === 'multi'}
                  onChange={() => setMode('multi')}
                />
                <UsersIcon size={20} />
                <strong>Multiplayer</strong>
                <small>Monte com amigos, com chamada de voz.</small>
              </label>
              <label className="mode-option">
                <input
                  type="radio"
                  name="mode"
                  className="sr-only"
                  checked={mode === 'battle'}
                  onChange={() => setMode('battle')}
                />
                <SwordsIcon size={20} />
                <strong>Batalha</strong>
                <small>Lado contra lado: quem montar primeiro, ou mais no tempo.</small>
              </label>
              <label className="mode-option">
                <input
                  type="radio"
                  name="mode"
                  className="sr-only"
                  checked={mode === 'bullet'}
                  onChange={() => setMode('bullet')}
                />
                <TimerIcon size={20} />
                <strong>Bullet</strong>
                <small>Contra o relógio: quantos você monta em 3, 5 ou 10 min?</small>
              </label>
            </fieldset>

            {bullet && (
              <div className="choice-rows">
                <fieldset className="choice-row">
                  <legend>Jogadores</legend>
                  {BULLET_PLAYER_OPTIONS.map((count) => (
                    <label key={count} className="radio-chip">
                      <input
                        type="radio"
                        name="bullet-players"
                        className="sr-only"
                        checked={bulletPlayers === count}
                        onChange={() => setBulletPlayers(count)}
                      />
                      {count === 1 ? 'Solo' : count}
                    </label>
                  ))}
                </fieldset>
                {timeAndPieces}
                {/* Duplas contra duplas no estilo Bullet = batalha por tempo 2v2. */}
                <button
                  type="button"
                  className="btn-link"
                  onClick={() => {
                    setMode('battle');
                    setBattleTimed(true);
                    setFormat('2v2');
                  }}
                >
                  Contra outra dupla? Bullet 2v2 →
                </button>
              </div>
            )}

            {mode === 'battle' && (
              <div className="choice-rows">
                <fieldset className="choice-row">
                  <legend>Tipo</legend>
                  <label className="radio-chip">
                    <input
                      type="radio"
                      name="battle-type"
                      className="sr-only"
                      checked={!battleTimed}
                      onChange={() => setBattleTimed(false)}
                    />
                    Corrida
                  </label>
                  <label className="radio-chip">
                    <input
                      type="radio"
                      name="battle-type"
                      className="sr-only"
                      checked={battleTimed}
                      onChange={() => setBattleTimed(true)}
                    />
                    <TimerIcon size={16} />
                    Por tempo
                  </label>
                </fieldset>
                <fieldset className="choice-row">
                  <legend>Formato</legend>
                  {(['1v1', '2v2'] as const).map((value) => (
                    <label key={value} className="radio-chip">
                      <input
                        type="radio"
                        name="format"
                        className="sr-only"
                        checked={format === value}
                        onChange={() => setFormat(value)}
                      />
                      {value}
                    </label>
                  ))}
                </fieldset>
                <fieldset className="choice-row">
                  <legend>Poderes</legend>
                  <label className="radio-chip">
                    <input
                      type="radio"
                      name="battle-powers"
                      className="sr-only"
                      checked={powers}
                      onChange={() => setPowers(true)}
                    />
                    <BoltIcon size={16} />
                    Com poderes
                  </label>
                  <label className="radio-chip">
                    <input
                      type="radio"
                      name="battle-powers"
                      className="sr-only"
                      checked={!powers}
                      onChange={() => setPowers(false)}
                    />
                    Sem
                  </label>
                </fieldset>
                {timedBattle && timeAndPieces}
                {!custom && !timedBattle && (
                  <fieldset className="choice-row">
                    <legend>Foto</legend>
                    <label className="radio-chip">
                      <input
                        type="radio"
                        name="battle-image"
                        className="sr-only"
                        checked={!randomImage}
                        onChange={() => setRandomImage(false)}
                      />
                      Esta foto
                    </label>
                    <label className="radio-chip">
                      <input
                        type="radio"
                        name="battle-image"
                        className="sr-only"
                        checked={randomImage}
                        onChange={() => setRandomImage(true)}
                      />
                      <ShuffleIcon size={16} />
                      Aleatória
                    </label>
                  </fieldset>
                )}
              </div>
            )}

            {mode === 'multi' && (
              <div className="choice-rows">
                <fieldset className="choice-row">
                  <legend>Jogadores</legend>
                  {PLAYER_OPTIONS.map((count) => (
                    <label key={count} className="radio-chip">
                      <input
                        type="radio"
                        name="players"
                        className="sr-only"
                        checked={players === count}
                        onChange={() => setPlayers(count)}
                      />
                      {count}
                    </label>
                  ))}
                </fieldset>
                {!custom && (
                  <fieldset className="choice-row">
                    <legend>Foto</legend>
                    <label className="radio-chip">
                      <input
                        type="radio"
                        name="image"
                        className="sr-only"
                        checked={!randomImage}
                        onChange={() => setRandomImage(false)}
                      />
                      Esta foto
                    </label>
                    <label className="radio-chip">
                      <input
                        type="radio"
                        name="image"
                        className="sr-only"
                        checked={randomImage}
                        onChange={() => setRandomImage(true)}
                      />
                      <ShuffleIcon size={16} />
                      Aleatória
                    </label>
                  </fieldset>
                )}
              </div>
            )}

            {!drawn && <SizeOptions pieceCount={pieceCount} onPieceCount={setPieceCount} />}

            {nameLocked ? (
              <p className="field-hint locked-name">
                Você entra como <strong>{name}</strong>, o nickname do seu perfil.
              </p>
            ) : (
              <label className="field">
                Seu nome
                <input
                  className="input"
                  value={name}
                  maxLength={20}
                  data-autofocus
                  onChange={(e) => onNameChange(e.target.value)}
                />
                <small className="field-hint">
                  {mode === 'solo' || bullet
                    ? 'É o nome que aparece no ranking.'
                    : 'É assim que seus amigos vão te ver na sala.'}
                </small>
              </label>
            )}

            {error && <p className="error">{error}</p>}

            <div className="dialog-actions play-actions">
              <button type="button" className="btn" onClick={onClose}>
                Cancelar
              </button>
              <button className="btn btn-primary" disabled={busy || missingPhoto}>
                {busy
                  ? 'Criando…'
                  : mode === 'solo' || (bullet && bulletPlayers === 1)
                    ? 'Começar'
                    : 'Criar sala'}
                {!busy && <ArrowRightIcon size={18} />}
              </button>
            </div>

            {/* No fim do formulário (desenhado no canto): na ordem do Tab, o X vem por último. */}
            <button
              type="button"
              className="tool icon-only play-close"
              aria-label="Fechar"
              onClick={onClose}
            >
              <CloseIcon size={18} />
            </button>
          </form>
        </>
      )}
    </Dialog>
  );
}

/** Bullet não usa a foto escolhida: mostra como a partida funciona no lugar dela. */
function BulletPreview({ pieces }: { pieces: number }) {
  return (
    <>
      <div className="play-photo bullet-preview">
        <TimerIcon size={40} />
        <span className="play-count">{pieces} peças cada</span>
      </div>
      <div className="play-caption">
        <strong>Fotos sorteadas</strong>
        <p>Terminou um quebra-cabeça, entra outro do catálogo na hora, até o tempo acabar.</p>
      </div>
    </>
  );
}

/** Área tracejada para escolher a foto da sala personalizada (envia na hora). */
function PhotoUpload({ onUploaded }: { onUploaded: (image: UploadedImage) => void }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string>();

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ''; // permite escolher o mesmo arquivo de novo
    if (!file) return;
    setUploading(true);
    setError(undefined);
    try {
      onUploaded(await uploadImage(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setUploading(false);
    }
  }

  return (
    <label className={uploading ? 'upload-card busy' : 'upload-card'}>
      <input
        type="file"
        accept="image/*"
        className="sr-only"
        aria-label="Escolher a foto do quebra-cabeça"
        disabled={uploading}
        onChange={handleFile}
      />
      <span className="upload-mark">
        <CameraIcon size={24} />
      </span>
      <strong>{uploading ? 'Enviando…' : 'Escolher foto'}</strong>
      <small>JPG, PNG ou WEBP · vira um quebra-cabeça só seu (fora do ranking)</small>
      {error && <span className="error">{error}</span>}
    </label>
  );
}

interface MediaPreviewProps {
  /** undefined = foto aleatória (ainda não se sabe qual: o servidor sorteia). */
  choice?: PuzzleChoice;
  aspect: number;
  onAspect: (aspect: number) => void;
  pieceCount: number;
  onChangePhoto?: () => void;
}

/** A foto grande, com o total de peças (linhas × colunas de verdade) num selo por cima. */
function MediaPreview({ choice, aspect, onAspect, pieceCount, onChangePhoto }: MediaPreviewProps) {
  const { rows, cols } = gridForPieceCount(pieceCount, choice ? aspect : 4 / 3);
  // Proporção da moldura limitada: foto muito alta ou muito larga é cortada nas pontas.
  const frame = { aspectRatio: choice ? Math.min(16 / 9, Math.max(3 / 4, aspect)) : 4 / 3 };

  return (
    <>
      <div className={choice ? 'play-photo' : 'play-photo random'} style={frame}>
        {choice ? (
          <img
            src={choice.thumbUrl}
            alt=""
            onLoad={(e) => onAspect(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)}
          />
        ) : (
          <ShuffleIcon size={36} />
        )}
        <span className="play-count" aria-live="polite">
          {choice
            ? `${cols} × ${rows} = ${formatCount(cols * rows)} peças`
            : `cerca de ${formatCount(pieceCount)} peças`}
        </span>
      </div>
      <div className="play-caption">
        <strong>{choice ? choice.title : 'Foto aleatória'}</strong>
        <p>{choice ? choice.subtitle : 'Sorteada entre as do catálogo ao criar a sala'}</p>
        {onChangePhoto && (
          <button type="button" className="btn-link" onClick={onChangePhoto}>
            Trocar foto
          </button>
        )}
      </div>
    </>
  );
}

function SizeOptions({
  pieceCount,
  onPieceCount,
}: {
  pieceCount: number;
  onPieceCount: (count: number) => void;
}) {
  return (
    <fieldset className="size-options">
      <legend>Tamanho</legend>
      {PIECE_COUNT_PRESETS.map((count) => {
        const optionLevel = difficultyOf(count);
        return (
          <label key={count} className="size-option">
            <input
              type="radio"
              name="pieces"
              className="sr-only"
              checked={count === pieceCount}
              onChange={() => onPieceCount(count)}
            />
            <span className="size-option-check" aria-hidden="true">
              <CheckIcon size={12} />
            </span>
            <span className="size-option-number">{formatCount(count)}</span>
            <span className="size-option-unit">peças</span>
            <span className="size-option-level">
              <Pips level={optionLevel} />
              {DIFFICULTY_NAMES[optionLevel - 1]}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
