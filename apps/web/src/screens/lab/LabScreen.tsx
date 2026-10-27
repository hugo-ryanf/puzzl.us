import { useEffect, useState, type ReactNode } from 'react';
import { CATALOG, isSolved, scrambleTiles, slide, solvedTiles } from '@puzzle/shared';
import type { PuzzleRoom } from '../../net/connection';
import type { BoardView, RoomSnapshot } from '../../net/useRoomSnapshot';
import {
  playCountdown,
  playSound,
  setSoundEnabled,
  useSoundEnabled,
  type GameSound,
} from '../../sound/sounds';
import { EnergyMeter, PowerBar } from '../battle/PowerBar';
import { TugOfWar } from '../battle/TugOfWar';
import { BonusBurst, LightningBanner } from '../bullet/BulletExtras';
import { GameClock } from '../GameClock';
import { ComboBurst } from '../room/ComboBurst';
import { FinalSeconds } from '../room/FinalSeconds';
import { SlidingPuzzle } from '../room/SlidingPuzzle';
import { StartCountdown } from '../room/StartCountdown';

/** Grade a um movimento de resolver (a peça 7 no lugar do vazio). */
const NEARLY_SOLVED = [0, 1, 2, 3, 4, 5, 6, 8, 7];
const LIMIT_MS = 180_000;
const SOUNDS: GameSound[] = [
  'snap',
  'solved',
  'win',
  'lose',
  'draw',
  'end',
  'bonus',
  'lightning',
  'magnet',
  'shield',
  'fog',
  'freeze',
  'shuffle',
  'suddenDeath',
  'record',
  'invite',
];

/** Sala de mentira: os componentes que mandam mensagem só registram no console. */
const fakeRoom = {
  sessionId: 'eu',
  send: (type: string, message?: unknown) => console.info('[lab] mandaria', type, message),
} as unknown as PuzzleRoom;

const fakeBoard = (overrides: Partial<BoardView> = {}): BoardView => ({
  imageId: CATALOG[0]!.id,
  seed: 'lab',
  solved: 0,
  golden: -1,
  lightning: false,
  energy: 0,
  shield: false,
  powerReadyAt: 0,
  fogUntil: 0,
  frozenUntil: 0,
  pieces: 12,
  placed: 0,
  done: false,
  durationMs: 0,
  ...overrides,
});

const fakeSnapshot = (overrides: Partial<RoomSnapshot> = {}): RoomSnapshot => ({
  mode: 'battle',
  players: [
    {
      sessionId: 'eu',
      name: 'Você',
      color: '#3a9aad',
      connected: true,
      snaps: 0,
      combo: 0,
      team: 'a',
    },
    {
      sessionId: 'bia',
      name: 'Bia',
      color: '#e8590c',
      connected: true,
      snaps: 0,
      combo: 0,
      team: 'b',
    },
  ],
  hostId: 'eu',
  ownerId: '',
  phase: 'playing',
  imageId: CATALOG[0]!.id,
  pieceCount: 12,
  maxPlayers: 2,
  pieces: 12,
  groups: 12,
  placed: 0,
  elapsedMs: 0,
  durationMs: 0,
  rankStatus: '',
  rank: 0,
  rankToday: 0,
  points: 0,
  teamSize: 2,
  boards: { a: fakeBoard(), b: fakeBoard() },
  timeLimitMs: LIMIT_MS,
  remainingMs: LIMIT_MS,
  countdown: 0,
  bonusMs: 0,
  helpers: 0,
  record: false,
  powers: true,
  slides: {},
  slideSeconds: 0,
  slideWinner: '',
  paused: false,
  suddenDeath: false,
  round: 1,
  solved: 0,
  partial: 0,
  winner: '',
  walkover: false,
  ...overrides,
});

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="lab-section">
      <h2>{title}</h2>
      {hint && <p className="caption">{hint}</p>}
      {children}
    </section>
  );
}

/** Relâmpago de deslizar, sozinho: embaralhar, deixar quase pronto e deslizar à vontade. */
function SlidingLab() {
  const [tiles, setTiles] = useState(() => scrambleTiles(Math.random));
  const [moves, setMoves] = useState(0);
  const solved = isSolved(tiles);
  const reset = (next: number[]) => {
    setTiles(next);
    setMoves(0);
  };
  return (
    <Section
      title="Relâmpago de deslizar"
      hint="A foto vem de public/relampago/foto.webp (sem ela, uma do catálogo)."
    >
      <div className="lab-row">
        <button type="button" className="btn" onClick={() => reset(scrambleTiles(Math.random))}>
          Embaralhar
        </button>
        <button type="button" className="btn" onClick={() => reset(NEARLY_SOLVED)}>
          Quase pronto
        </button>
        <button type="button" className="btn" onClick={() => reset(solvedTiles())}>
          Resolvido
        </button>
        <span>
          {moves} movimentos {solved && '· Montado!'}
        </span>
      </div>
      <div className="lab-row">
        <SlidingPuzzle
          tiles={tiles}
          label="Grade de teste"
          onSlide={(index) => {
            const next = slide(tiles, index);
            setTiles(next);
            setMoves((count) => count + 1);
            playSound(isSolved(next) ? 'solved' : 'snap');
          }}
        />
        <SlidingPuzzle tiles={tiles} label="Como o adversário vê" />
      </div>
    </Section>
  );
}

/** "3, 2, 1, Já!" com o som. */
function CountdownLab() {
  const [countdown, setCountdown] = useState(0);
  useEffect(() => {
    if (countdown === 0) return;
    const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);
  return (
    <Section title="Contagem antes de começar">
      <div className="lab-row">
        <button type="button" className="btn" onClick={() => setCountdown(3)}>
          Começar 3, 2, 1
        </button>
      </div>
      <div className="lab-stage">
        <StartCountdown countdown={countdown} />
      </div>
    </Section>
  );
}

/** Últimos segundos: o relógio do cabeçalho e o grande, pegando fogo, com o som. */
function FinalSecondsLab() {
  const [seconds, setSeconds] = useState(12);
  const [run, setRun] = useState(0);
  const [onDivider, setOnDivider] = useState(true);
  const [bonus, setBonus] = useState(0);
  const snapshot = fakeSnapshot({ elapsedMs: LIMIT_MS - seconds * 1000, bonusMs: bonus });
  return (
    <Section
      title="Últimos segundos e fogo"
      hint="Escolha quantos segundos faltam e rode; o relógio anda de verdade a partir daí."
    >
      <div className="lab-row">
        <label>
          Faltando {seconds} s{' '}
          <input
            type="range"
            min={1}
            max={30}
            value={seconds}
            onChange={(event) => setSeconds(Number(event.target.value))}
          />
        </label>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            setBonus(0);
            setRun(run + 1);
          }}
        >
          Rodar
        </button>
        <button type="button" className="btn" onClick={() => setBonus(bonus + 5000)}>
          +5 s (bônus)
        </button>
        <label>
          <input
            type="checkbox"
            checked={onDivider}
            onChange={(event) => setOnDivider(event.target.checked)}
          />{' '}
          Na linha do meio (batalha)
        </label>
      </div>
      {run > 0 && (
        <div key={run}>
          <span className="clock-pill">
            <GameClock
              phase="playing"
              elapsedMs={snapshot.elapsedMs}
              durationMs={0}
              limitMs={LIMIT_MS + bonus}
            />
          </span>
          <div className="lab-stage">
            <FinalSeconds snapshot={snapshot} onDivider={onDivider} />
            <BonusBurst bonusMs={bonus} />
          </div>
        </div>
      )}
    </Section>
  );
}

/** Barra de poderes e os efeitos na mesa de quem recebe. */
function PowersLab() {
  const [energy, setEnergy] = useState(60);
  const [cooldown, setCooldown] = useState(0);
  const [shield, setShield] = useState(false);
  const [fog, setFog] = useState(false);
  const [frozen, setFrozen] = useState(false);
  const board = fakeBoard({
    energy,
    shield,
    powerReadyAt: cooldown * 1000,
    frozenUntil: frozen ? 1 : 0,
  });
  return (
    <Section
      title="Poderes"
      hint="Os botões só registram no console aqui; os efeitos aparecem na mesa ao lado."
    >
      <div className="lab-row">
        <label>
          Energia {energy}{' '}
          <input
            type="range"
            min={0}
            max={100}
            value={energy}
            onChange={(event) => setEnergy(Number(event.target.value))}
          />
        </label>
        <label>
          Recarga {cooldown} s{' '}
          <input
            type="range"
            min={0}
            max={12}
            value={cooldown}
            onChange={(event) => setCooldown(Number(event.target.value))}
          />
        </label>
        {(
          [
            ['Escudo armado', shield, setShield],
            ['Neblina', fog, setFog],
            ['Congelado', frozen, setFrozen],
          ] as const
        ).map(([label, value, set]) => (
          <label key={label}>
            <input type="checkbox" checked={value} onChange={(e) => set(e.target.checked)} />{' '}
            {label}
          </label>
        ))}
        <EnergyMeter board={board} />
      </div>
      <div className="lab-stage">
        {fog && <div className="power-fog" aria-hidden="true" />}
        {frozen && (
          <div className="power-frozen" role="status">
            Congelado!
          </div>
        )}
        <PowerBar room={fakeRoom} board={board} now={0} active />
      </div>
    </Section>
  );
}

/** Combo, bônus, relâmpago, recorde e o cabo de guerra. */
function FeedbackLab() {
  const [combo, setCombo] = useState(1);
  const [bonus, setBonus] = useState(0);
  const [lead, setLead] = useState(0);
  const [hot, setHot] = useState(false);
  const snapshot = fakeSnapshot({
    boards: {
      a: fakeBoard({ solved: Math.max(0, lead) }),
      b: fakeBoard({ solved: Math.max(0, -lead) }),
    },
  });
  return (
    <Section title="Combo, bônus e cabo de guerra">
      <div className="lab-row">
        <button type="button" className="btn" onClick={() => setCombo(combo + 1)}>
          Encaixe seguido (combo {combo + 1})
        </button>
        <button type="button" className="btn" onClick={() => setCombo(1)}>
          Zerar combo
        </button>
        <button type="button" className="btn" onClick={() => setBonus(bonus + 5000)}>
          +5 s
        </button>
        <label>
          Vantagem {lead > 0 ? `+${lead}` : lead}{' '}
          <input
            type="range"
            min={-3}
            max={3}
            value={lead}
            onChange={(event) => setLead(Number(event.target.value))}
          />
        </label>
        <label>
          <input type="checkbox" checked={hot} onChange={(e) => setHot(e.target.checked)} /> Fogo
          (últimos 10 s)
        </label>
      </div>
      <div className="lab-stage">
        <LightningBanner />
        <ComboBurst combo={combo} />
        <BonusBurst bonusMs={bonus} />
        <div className="battle-hud">
          <TugOfWar snapshot={snapshot} myTeam="a" hot={hot} />
        </div>
      </div>
    </Section>
  );
}

function SoundsLab() {
  const enabled = useSoundEnabled();
  return (
    <Section title="Sons">
      <div className="lab-row">
        <label>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setSoundEnabled(event.target.checked)}
          />{' '}
          Sons ligados
        </label>
        <button type="button" className="btn" onClick={() => playCountdown(3000)}>
          Contagem (3 s)
        </button>
        <button type="button" className="btn" onClick={() => playCountdown(10_000)}>
          Contagem (10 s)
        </button>
      </div>
      <div className="lab-row">
        {SOUNDS.map((sound) => (
          <button key={sound} type="button" className="btn" onClick={() => playSound(sound)}>
            {sound}
          </button>
        ))}
      </div>
    </Section>
  );
}

/**
 * Laboratório (só no `pnpm dev`, em /lab): cada parte do Bullet e da batalha sozinha, com
 * controles, para ajustar sem jogar uma partida inteira. Não entra no build de produção.
 */
export default function LabScreen() {
  return (
    <main className="lab">
      <header>
        <h1>Laboratório</h1>
        <p className="caption">
          Só existe no ambiente de desenvolvimento. Para testar dentro de uma sala de verdade, use o
          painel "Testes" (servidor de <code>pnpm dev:local</code>).
        </p>
      </header>
      <SlidingLab />
      <CountdownLab />
      <FinalSecondsLab />
      <PowersLab />
      <FeedbackLab />
      <SoundsLab />
    </main>
  );
}
