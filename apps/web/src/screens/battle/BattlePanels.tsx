import { useState } from 'react';
import { BATTLE_TEAMS, type BattleTeam } from '@puzzle/shared';
import { formatDuration } from '../../format';
import type { PuzzleRoom } from '../../net/connection';
import type { RoomSnapshot } from '../../net/useRoomSnapshot';
import { ImageIcon, PartyIcon, SwordsIcon } from '../../ui/icons';
import { PlayAgainButton } from '../room/PlayAgainButton';
import { t } from '../../i18n';

const TEAM_NAMES: Record<BattleTeam, string> = { a: t('Lado A'), b: t('Lado B') };

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
          <SwordsIcon size={22} /> {t('Batalha {a}v{a}', { a: perTeam })}
        </h2>
        {snapshot.timeLimitMs > 0 ? (
          <p>
            {t(
              'Por tempo: {minutes} min, quebra-cabeças de {pieces} peças. Os dois lados recebem as mesmas fotos, na mesma ordem; montou um, vem o próximo. Quem montar mais quando o tempo acabar ganha.',
              { minutes: snapshot.timeLimitMs / 60_000, pieces: snapshot.pieceCount },
            )}
          </p>
        ) : (
          <p>
            {t(
              'Os dois lados montam o mesmo quebra-cabeça ({pieces} peças), cada um na sua mesa. Quem terminar primeiro ganha.',
              { pieces: snapshot.pieceCount },
            )}
          </p>
        )}
        {snapshot.powers && (
          <p className="caption">
            {t(
              'Com poderes: os encaixes enchem a energia do lado; gaste em Escudo, Neblina, Congelar ou Embaralhar (teclas 1 a 4).',
            )}
          </p>
        )}
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
                      {t('vaga livre')}
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
                    {full ? t('Cheio') : t('Ir para este lado')}
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
            {ready ? t('Começar') : t('Esperando o outro lado…')}
          </button>
        ) : (
          <p>{t('Esperando {name} começar…', { name: hostName ?? t('o anfitrião') })}</p>
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
  const draw = snapshot.winner === 'draw';
  const winner = (draw ? 'a' : snapshot.winner) as BattleTeam;
  const me = snapshot.players.find((p) => p.sessionId === room.sessionId);
  const won = !draw && me?.team === winner;
  const loser: BattleTeam = winner === 'a' ? 'b' : 'a';
  const timed = snapshot.timeLimitMs > 0;
  const solvedBy = (team: BattleTeam) => snapshot.boards[team]?.solved ?? 0;
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
        {t('Ver resultado')}
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
          <h2 id="battle-title">
            {draw ? t('Empate!') : won ? t('Vitória!') : t('Não foi dessa vez')}
          </h2>
          {draw ? (
            <p className="caption">
              {t('Os dois lados montaram {n} e empataram também nas peças encaixadas.', {
                n: solvedBy('a'),
              })}
            </p>
          ) : (
            <p className="caption">
              <strong>{names(winner) || TEAM_NAMES[winner]}</strong>{' '}
              {snapshot.walkover
                ? t('ganhou: o outro lado saiu.')
                : snapshot.suddenDeath
                  ? t('ganhou na morte súbita, depois de empatar em {n} montados.', {
                      n: solvedBy(winner),
                    })
                  : timed
                    ? solvedBy(winner) === solvedBy(loser)
                      ? t(
                          'ganhou no desempate: {n} montados para cada lado, mais peças encaixadas no último.',
                          { n: solvedBy(winner) },
                        )
                      : t('montou mais: {a} a {b}.', { a: solvedBy(winner), b: solvedBy(loser) })
                    : t('montou primeiro, em {time}.', {
                        time: formatDuration(snapshot.durationMs),
                      })}
            </p>
          )}
        </header>
        {!snapshot.walkover && !timed && (
          <section className="result-section">
            <h3>{t('Outro lado')}</h3>
            <p className="result-note">
              {t('{names} tinha montado {n}% quando acabou.', {
                names: names(loser) || TEAM_NAMES[loser],
                n: loserPercent,
              })}
            </p>
          </section>
        )}
        <div className="result-actions">
          <button type="button" className="btn" onClick={() => setOpen(false)}>
            <ImageIcon size={18} />
            {t('Ver as mesas')}
          </button>
          <PlayAgainButton room={room} snapshot={snapshot} />
          <button type="button" className="btn btn-primary" onClick={onLeave}>
            {t('Voltar ao início')}
          </button>
        </div>
      </section>
    </div>
  );
}
