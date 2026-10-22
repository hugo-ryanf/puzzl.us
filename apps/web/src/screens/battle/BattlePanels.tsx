import { useState } from 'react';
import { BATTLE_TEAMS, type BattleTeam } from '@puzzle/shared';
import { formatDuration } from '../../format';
import type { PuzzleRoom } from '../../net/connection';
import type { RoomSnapshot } from '../../net/useRoomSnapshot';
import { ImageIcon, PartyIcon, SwordsIcon } from '../../ui/icons';
import { PlayAgainButton } from '../room/PlayAgainButton';

const TEAM_NAMES: Record<BattleTeam, string> = { a: 'Lado A', b: 'Lado B' };

/** Lobby da Batalha: os dois lados lado a lado; cada um escolhe o seu, o anfitrião começa. */
export function BattleLobby({ room, snapshot }: { room: PuzzleRoom; snapshot: RoomSnapshot }) {
  const perTeam = snapshot.maxPlayers / 2;
  const me = snapshot.players.find((p) => p.sessionId === room.sessionId);
  const isHost = snapshot.hostId === room.sessionId;
  const hostName = snapshot.players.find((p) => p.sessionId === snapshot.hostId)?.name;
  const ready = BATTLE_TEAMS.every((team) => snapshot.players.some((p) => p.team === team));

  return (
    <div className="overlay">
      <div className="panel battle-lobby">
        <h2>
          <SwordsIcon size={22} /> Batalha {perTeam}v{perTeam}
        </h2>
        <p>
          Os dois lados montam o mesmo quebra-cabeça ({snapshot.pieceCount} peças), cada um na sua
          mesa. Quem terminar primeiro ganha.
        </p>
        <div className="battle-teams">
          {BATTLE_TEAMS.map((team) => {
            const members = snapshot.players.filter((p) => p.team === team);
            const full = members.length >= perTeam;
            return (
              <div key={team} className={me?.team === team ? 'battle-team mine' : 'battle-team'}>
                <strong>{TEAM_NAMES[team]}</strong>
                <ul>
                  {members.map((p) => (
                    <li key={p.sessionId}>
                      <span className="contribution-dot" style={{ background: p.color }} />
                      {p.name}
                    </li>
                  ))}
                  {Array.from({ length: perTeam - members.length }, (_, i) => (
                    <li key={`vaga-${i}`} className="empty-slot">
                      vaga livre
                    </li>
                  ))}
                </ul>
                {me?.team !== team && (
                  <button
                    type="button"
                    className="btn"
                    disabled={full}
                    onClick={() => room.send('chooseTeam', { team })}
                  >
                    {full ? 'Cheio' : 'Ir para este lado'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {isHost ? (
          <button
            type="button"
            className="btn btn-primary btn-lg"
            disabled={!ready}
            onClick={() => room.send('start')}
          >
            {ready ? 'Começar' : 'Esperando o outro lado…'}
          </button>
        ) : (
          <p>Esperando {hostName ?? 'o anfitrião'} começar…</p>
        )}
      </div>
    </div>
  );
}

/** Fim da Batalha: quem ganhou, em quanto tempo e quanto o outro lado tinha montado. */
export function BattleResult({
  room,
  snapshot,
  onLeave,
}: {
  room: PuzzleRoom;
  snapshot: RoomSnapshot;
  onLeave: () => void;
}) {
  const [open, setOpen] = useState(true);
  const winner = snapshot.winner as BattleTeam;
  const me = snapshot.players.find((p) => p.sessionId === room.sessionId);
  const won = me?.team === winner;
  const loser: BattleTeam = winner === 'a' ? 'b' : 'a';
  const names = (team: BattleTeam) =>
    snapshot.players
      .filter((p) => p.team === team)
      .map((p) => p.name)
      .join(' & ');
  const loserBoard = snapshot.boards[loser];
  const loserPercent =
    loserBoard && loserBoard.pieces > 0
      ? Math.round((loserBoard.placed / loserBoard.pieces) * 100)
      : 0;

  if (!open) {
    return (
      <button type="button" className="btn result-reopen" onClick={() => setOpen(true)}>
        <SwordsIcon size={18} />
        Ver resultado
      </button>
    );
  }
  return (
    <div className="overlay result-overlay" onClick={() => setOpen(false)}>
      <section
        className="result"
        role="dialog"
        aria-labelledby="battle-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="result-header">
          <span className="result-badge" aria-hidden="true">
            {won ? <PartyIcon size={26} /> : <SwordsIcon size={26} />}
          </span>
          <h2 id="battle-title">{won ? 'Vitória!' : 'Não foi dessa vez'}</h2>
          <p className="caption">
            <strong>{names(winner) || TEAM_NAMES[winner]}</strong>{' '}
            {snapshot.walkover
              ? 'ganhou: o outro lado saiu.'
              : `montou primeiro, em ${formatDuration(snapshot.durationMs)}.`}
          </p>
        </header>
        {!snapshot.walkover && (
          <section className="result-section">
            <h3>Outro lado</h3>
            <p className="result-note">
              {names(loser) || TEAM_NAMES[loser]} tinha montado {loserPercent}% quando acabou.
            </p>
          </section>
        )}
        <div className="result-actions">
          <button type="button" className="btn" onClick={() => setOpen(false)}>
            <ImageIcon size={18} />
            Ver as mesas
          </button>
          <PlayAgainButton room={room} snapshot={snapshot} />
          <button type="button" className="btn btn-primary" onClick={onLeave}>
            Voltar ao início
          </button>
        </div>
      </section>
    </div>
  );
}
