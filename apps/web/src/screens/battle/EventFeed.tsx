import { useEffect, useState } from 'react';
import type { BattleTeam, PowerBroadcast } from '@puzzle/shared';
import type { PuzzleRoom } from '../../net/connection';
import type { RoomSnapshot } from '../../net/useRoomSnapshot';
import { playSound } from '../../sound/sounds';
import { POWER_LABELS } from './PowerBar';
import { battleScore, otherTeam, teamNames } from './score';
import { t } from '../../i18n';

/** Quanto tempo cada aviso fica e quantos cabem de uma vez. */
const SHOW_MS = 2500;
const MAX_ITEMS = 3;

interface FeedItem {
  id: number;
  text: string;
  tone: 'mine' | 'theirs';
}

/**
 * Avisos curtos da batalha no topo das mesas: alguém montou (por tempo), virada no placar,
 * "falta pouco" (corrida a 90%) e os poderes usados. O placar vem das mudanças do estado: o
 * anterior fica guardado e, quando muda, os avisos entram (ajuste de estado na renderização, sem
 * efeito). Os poderes chegam pela mensagem 'power' (com o som de cada um).
 */
export function EventFeed({
  room,
  snapshot,
  myTeam,
}: {
  room: PuzzleRoom;
  snapshot: RoomSnapshot;
  myTeam: BattleTeam;
}) {
  const timed = snapshot.timeLimitMs > 0;
  const other = otherTeam(myTeam);
  const solved = (team: BattleTeam) => snapshot.boards[team]?.solved ?? 0;
  const score = (team: BattleTeam) => battleScore(snapshot, team);
  // Por tempo, o placar é o de montados; na corrida, a mesa em passos de 5% (menos troca à toa).
  const diff = timed
    ? solved(myTeam) - solved(other)
    : Math.round(score(myTeam) * 20) - Math.round(score(other) * 20);
  const leader: BattleTeam | '' = diff > 0 ? myTeam : diff < 0 ? other : '';
  const current = {
    round: snapshot.round,
    solved: { a: solved('a'), b: solved('b') },
    nearEnd: { a: !timed && score('a') >= 0.9, b: !timed && score('b') >= 0.9 },
  };

  const [items, setItems] = useState<FeedItem[]>([]);
  // Empate não apaga quem estava na frente: a virada é quando o outro passa.
  const [tracked, setTracked] = useState({ ...current, leader, nextId: 1 });

  const changed =
    current.round !== tracked.round ||
    current.solved.a !== tracked.solved.a ||
    current.solved.b !== tracked.solved.b ||
    current.nearEnd.a !== tracked.nearEnd.a ||
    current.nearEnd.b !== tracked.nearEnd.b ||
    (leader !== '' && leader !== tracked.leader);
  if (changed) {
    const added: FeedItem[] = [];
    let nextId = tracked.nextId;
    const add = (text: string, team: BattleTeam) =>
      added.push({ id: nextId++, text, tone: team === myTeam ? 'mine' : 'theirs' });
    const who = (team: BattleTeam) => {
      const many = snapshot.players.filter((p) => p.team === team).length > 1;
      if (team === myTeam) return { name: many ? t('Vocês') : t('Você'), many };
      return { name: teamNames(snapshot, team) || t('Adversário'), many };
    };

    if (snapshot.phase === 'playing' && current.round === tracked.round) {
      for (const team of [myTeam, other]) {
        const { name, many } = who(team);
        if (timed && current.solved[team] > tracked.solved[team]) {
          add(
            t(many ? '{name} montaram! {a} × {b}' : '{name} montou! {a} × {b}', {
              name,
              a: solved(myTeam),
              b: solved(other),
            }),
            team,
          );
        }
        if (current.nearEnd[team] && !tracked.nearEnd[team])
          add(t('{name}: falta pouco!', { name }), team);
      }
      const started = timed || Math.max(score(myTeam), score(other)) >= 0.3;
      if (leader && tracked.leader && leader !== tracked.leader && started) {
        add(t('Virada! {name} na frente', { name: who(leader).name }), leader);
      }
    }
    setTracked({ ...current, leader: leader || tracked.leader, nextId });
    if (added.length > 0) setItems([...items, ...added].slice(-MAX_ITEMS));
  }

  // Poderes: quem usou, em quem, e se o escudo anulou.
  const theirNames = teamNames(snapshot, other) || t('Adversário');
  useEffect(
    () =>
      room.onMessage('power', ({ team, power, blocked }: PowerBroadcast) => {
        playSound(blocked ? 'shield' : power);
        const label = POWER_LABELS[power];
        const mine = team === myTeam;
        const text =
          power === 'shield'
            ? mine
              ? t('Escudo armado!')
              : t('{names} armaram um escudo', { names: theirNames })
            : blocked
              ? mine
                ? t('O escudo deles anulou {power}', { power: label })
                : t('Seu escudo anulou {power}!', { power: label })
              : mine
                ? t('{power} no adversário!', { power: label })
                : t('{names}: {power} em vocês!', { names: theirNames, power: label });
        // Bom para mim: o meu poder que pegou, ou o deles que o meu escudo anulou.
        const item: FeedItem = {
          id: -Date.now(),
          text,
          tone: mine !== blocked ? 'mine' : 'theirs',
        };
        setItems((list) => [...list, item].slice(-MAX_ITEMS));
      }),
    [room, myTeam, theirNames],
  );

  // O mais antigo sai depois de um tempo; o próximo, outro tempo depois.
  useEffect(() => {
    if (items.length === 0) return;
    const timer = setTimeout(() => setItems((list) => list.slice(1)), SHOW_MS);
    return () => clearTimeout(timer);
  }, [items]);

  if (items.length === 0) return null;
  return (
    <ol className="event-feed" aria-live="polite">
      {items.map((item) => (
        <li key={item.id} className={`event-item ${item.tone}`}>
          {item.text}
        </li>
      ))}
    </ol>
  );
}
