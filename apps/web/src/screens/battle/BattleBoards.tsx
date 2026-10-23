import { useEffect, useState } from 'react';
import type { BattleTeam } from '@puzzle/shared';
import { Board } from '../../board/Board';
import { usePuzzleImage } from '../../board/usePuzzleImage';
import type { PuzzleRoom } from '../../net/connection';
import type { RoomSnapshot } from '../../net/useRoomSnapshot';
import { BoltIcon, SnowflakeIcon } from '../../ui/icons';
import { useGameTime } from '../GameClock';
import { ComboBurst } from '../room/ComboBurst';
import { FinalSeconds, useFinalSeconds } from '../room/FinalSeconds';
import { EventFeed } from './EventFeed';
import { EnergyMeter, PowerBar } from './PowerBar';
import { otherTeam } from './score';
import { TugOfWar } from './TugOfWar';

/** Abaixo disso a tela dividida não cabe: um tabuleiro por vez, com abas. */
const NARROW_QUERY = '(max-width: 760px)';

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => matchMedia(NARROW_QUERY).matches);
  useEffect(() => {
    const media = matchMedia(NARROW_QUERY);
    const update = () => setNarrow(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return narrow;
}

/** Nomes, progresso e situação de um lado, em cima da metade dele. */
function SideHeader({
  snapshot,
  team,
  mine,
}: {
  snapshot: RoomSnapshot;
  team: BattleTeam;
  mine: boolean;
}) {
  const board = snapshot.boards[team];
  const names = snapshot.players.filter((p) => p.team === team).map((p) => p.name);
  const percent = board && board.pieces > 0 ? Math.round((board.placed / board.pieces) * 100) : 0;
  const timed = snapshot.timeLimitMs > 0;
  return (
    <div className={mine ? 'battle-side-header mine' : 'battle-side-header'}>
      <span className="battle-side-names">
        <strong>{mine ? 'Seu lado' : 'Adversário'}</strong>
        <small>{names.join(' & ') || 'ninguém ainda'}</small>
      </span>
      {snapshot.powers && <EnergyMeter board={board} />}
      {board?.lightning && (
        <span className="lightning-pill" title="Rodada relâmpago: quebra-cabeça de 6 peças">
          <BoltIcon size={14} /> Relâmpago
        </span>
      )}
      {timed && (
        <span className="solved-pill" aria-label={`${board?.solved ?? 0} montados`}>
          <strong>{board?.solved ?? 0}</strong> {board?.solved === 1 ? 'montado' : 'montados'}
        </span>
      )}
      <span className="progress-bar" aria-hidden="true">
        <span style={{ width: `${percent}%` }} />
      </span>
      <strong className="battle-side-percent">
        {board?.done ? (timed ? '+1!' : 'Montou!') : `${percent}%`}
      </strong>
    </div>
  );
}

/**
 * A mesa de um lado. Na batalha por tempo cada lado pode estar numa foto diferente, então cada
 * metade carrega a sua; quebra-cabeça novo (seed nova) monta a cena do zero.
 */
function SideBoard({
  room,
  snapshot,
  team,
  mine,
  now,
}: {
  room: PuzzleRoom;
  snapshot: RoomSnapshot;
  team: BattleTeam;
  mine: boolean;
  /** Relógio da partida agora (ms): os efeitos dos poderes valem até um instante dele. */
  now: number;
}) {
  const view = snapshot.boards[team];
  const image = usePuzzleImage(view?.imageId ?? snapshot.imageId);
  const source = room.state.boards.get(team);
  if (!image?.image || !source || !view) {
    return <p className="board-loading">{image?.error ?? 'Carregando…'}</p>;
  }
  const playing = snapshot.phase === 'playing';
  return (
    <>
      <Board
        // Revanche ou quebra-cabeça seguinte = mesa nova: a cena recomeça do zero.
        key={`${snapshot.round}:${team}:${view.seed}`}
        room={room}
        image={image.image}
        phase={snapshot.phase}
        source={source}
        boardKey={team}
        readOnly={!mine}
      />
      {/* Efeitos dos poderes que este lado recebeu. */}
      {playing && view.fogUntil > now && <div className="power-fog" aria-hidden="true" />}
      {playing && view.frozenUntil > now && (
        <div className="power-frozen" role="status">
          <SnowflakeIcon size={28} />
          Congelado!
        </div>
      )}
    </>
  );
}

/**
 * Batalha: tela dividida ao meio na vertical. À esquerda o meu lado (dá para jogar), à direita o
 * do adversário (só assistir, ao vivo). No celular, abas para alternar entre os dois.
 */
export function BattleBoards({ room, snapshot }: { room: PuzzleRoom; snapshot: RoomSnapshot }) {
  const narrow = useNarrow();
  const [peek, setPeek] = useState(false);
  const me = snapshot.players.find((p) => p.sessionId === room.sessionId);
  const myTeam: BattleTeam = me?.team || 'a';
  const final = useFinalSeconds(snapshot);
  const playing = snapshot.phase === 'playing' && snapshot.countdown === 0;
  const now = useGameTime(
    snapshot.phase,
    snapshot.elapsedMs,
    snapshot.durationMs,
    snapshot.countdown > 0,
  );
  const sides: BattleTeam[] = narrow
    ? [peek ? otherTeam(myTeam) : myTeam]
    : [myTeam, otherTeam(myTeam)];

  return (
    <div className={narrow ? 'battle-split narrow' : 'battle-split'}>
      {narrow && (
        <div className="chips battle-tabs" role="group" aria-label="Tabuleiro">
          <button
            type="button"
            className="chip"
            aria-pressed={!peek}
            onClick={() => setPeek(false)}
          >
            Seu lado · {progressOf(snapshot, myTeam)}
          </button>
          <button type="button" className="chip" aria-pressed={peek} onClick={() => setPeek(true)}>
            Adversário · {progressOf(snapshot, otherTeam(myTeam))}
          </button>
        </div>
      )}
      {sides.map((team) => {
        const mine = team === myTeam;
        return (
          <section key={team} className={mine ? 'battle-side mine' : 'battle-side'}>
            <SideHeader snapshot={snapshot} team={team} mine={mine} />
            <div className="battle-board">
              <SideBoard room={room} snapshot={snapshot} team={team} mine={mine} now={now} />
              {mine && <ComboBurst combo={me?.combo ?? 0} />}
              {mine && snapshot.powers && snapshot.phase === 'playing' && (
                <PowerBar room={room} board={snapshot.boards[team]} now={now} active={playing} />
              )}
            </div>
          </section>
        );
      })}
      {playing && (
        <div className={narrow ? 'battle-hud narrow' : 'battle-hud'}>
          {snapshot.suddenDeath && (
            <div className="sudden-death-banner" role="status">
              Morte súbita! <small>Quem montar este primeiro ganha</small>
            </div>
          )}
          <TugOfWar snapshot={snapshot} myTeam={myTeam} hot={final.active} />
          <EventFeed room={room} snapshot={snapshot} myTeam={myTeam} />
        </div>
      )}
      {/* Por tempo: nos últimos 10 s, o relógio grande em cima da linha do meio. */}
      {snapshot.timeLimitMs > 0 && <FinalSeconds snapshot={snapshot} onDivider={!narrow} />}
    </div>
  );
}

/** Para as abas do celular: montados (por tempo) ou a porcentagem da mesa. */
function progressOf(snapshot: RoomSnapshot, team: BattleTeam): string {
  const board = snapshot.boards[team];
  if (snapshot.timeLimitMs > 0) {
    return `${board?.solved ?? 0} ${board?.solved === 1 ? 'montado' : 'montados'}`;
  }
  if (board?.done) return 'montou';
  return `${board && board.pieces > 0 ? Math.round((board.placed / board.pieces) * 100) : 0}%`;
}
