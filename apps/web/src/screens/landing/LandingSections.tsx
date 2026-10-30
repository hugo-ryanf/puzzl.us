import { CATALOG, MAX_PLAYERS, type CommunityPuzzle } from '@puzzle/shared';
import { catalogThumbUrl, localizedCatalogImage } from '../../board/images';
import { t } from '../../i18n';
import { ArrowRightIcon, CheckIcon } from '../../ui/icons';
import type { CreateRoomMode, PuzzleChoice } from '../explore/CreateRoomDialog';
import { LandingVideo } from './LandingVideo';

/** Entra no app: com uma foto (e um modo), o "Criar sala" dela; sem foto, o "Criar sala" livre. */
export type StartPlaying = (choice?: PuzzleChoice, mode?: CreateRoomMode) => void;

/** Uma foto do catálogo para os botões dos modos (a pessoa troca no diálogo, se quiser). */
function catalogChoice(index: number): PuzzleChoice {
  const image = CATALOG[index % CATALOG.length]!;
  const local = localizedCatalogImage(image);
  return {
    imageId: image.id,
    title: local.title,
    subtitle: local.credit || t('Foto do catálogo'),
    thumbUrl: catalogThumbUrl(image.id),
  };
}

function SectionHead({
  eyebrow,
  title,
  text,
  id,
}: {
  eyebrow: string;
  title: string;
  text?: string;
  id: string;
}) {
  return (
    <div className="lp-head">
      <span className="lp-eyebrow">{eyebrow}</span>
      <h2 id={id}>{title}</h2>
      {text && <p>{text}</p>}
    </div>
  );
}

const MODES: Array<{
  mode: CreateRoomMode;
  clip: string;
  photo: number;
  title: string;
  text: string;
}> = [
  {
    mode: 'multi',
    clip: 'classico',
    photo: 1,
    title: t('Clássico'),
    text: t(
      'Monte sozinho ou com amigos, de 24 a 1.000 peças. As peças vêm giradas: vire, encaixe e vença.',
    ),
  },
  {
    mode: 'bullet',
    clip: 'bullet',
    photo: 3,
    title: 'Bullet',
    text: t(
      'Contra o relógio: quantos quebra-cabeças você monta em 3, 5 ou 10 minutos? Sozinho ou em equipe.',
    ),
  },
  {
    mode: 'battle',
    clip: 'batalha',
    photo: 5,
    title: t('Batalha'),
    text: t(
      'Lado contra lado, com poderes (Neblina, Congelar, Escudo, Embaralhar) e o relâmpago de deslizar: quem montar primeiro leva.',
    ),
  },
];

/** Os três modos, cada um com o seu trecho e um "Jogar" que abre o "Criar sala" no modo. */
export function ModesSection({ onStart }: { onStart: StartPlaying }) {
  return (
    <section className="lp-section" aria-labelledby="lp-modes-title">
      <div className="lp-container">
        <SectionHead
          id="lp-modes-title"
          eyebrow={t('Modos de jogo')}
          title={t('Três jeitos de jogar')}
        />
        <div className="lp-modes">
          {MODES.map((item) => (
            <article key={item.mode} className="lp-mode">
              <LandingVideo name={item.clip} label={item.title} />
              <div className="lp-mode-body">
                <h3>{item.title}</h3>
                <p>{item.text}</p>
                <button
                  type="button"
                  className="lp-btn lp-btn-ghost"
                  onClick={() => onStart(catalogChoice(item.photo), item.mode)}
                >
                  {t('Jogar')}
                  <ArrowRightIcon size={18} />
                </button>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function Points({ items }: { items: string[] }) {
  return (
    <ul className="lp-points">
      {items.map((item) => (
        <li key={item}>
          <span className="lp-point-icon" aria-hidden="true">
            <CheckIcon size={16} />
          </span>
          {item}
        </li>
      ))}
    </ul>
  );
}

/** Multiplayer: cursores ao vivo, chamada e convite por link (o trecho da sala com os amigos). */
export function TogetherSection({ onStart }: { onStart: StartPlaying }) {
  return (
    <section className="lp-section" aria-labelledby="lp-together-title">
      <div className="lp-container lp-split">
        <div className="lp-split-copy">
          <SectionHead
            id="lp-together-title"
            eyebrow="Multiplayer"
            title={t('Jogue junto, de verdade')}
          />
          <Points
            items={[
              t(
                'Cada um com seu cursor e seu nome: você vê os amigos pegando e encaixando as peças na hora.',
              ),
              t('Chamada de voz e vídeo dentro da sala, sem abrir outro app.'),
              t('Mande o link: quem recebe entra direto na mesa.'),
            ]}
          />
          <button type="button" className="lp-btn lp-btn-primary" onClick={() => onStart()}>
            {t('Criar uma sala')}
            <ArrowRightIcon size={18} />
          </button>
        </div>
        <LandingVideo
          name="sala"
          label={t('Quatro amigos montando juntos, com a chamada de vídeo')}
        />
      </div>
    </section>
  );
}

/** Fotos dos jogadores: a cena do envio e as publicadas de verdade. */
export function CommunitySection({
  puzzles,
  onStart,
}: {
  puzzles: CommunityPuzzle[];
  onStart: StartPlaying;
}) {
  const shown = puzzles.filter((puzzle) => puzzle.status === 'published').slice(0, 6);
  return (
    <section className="lp-section" aria-labelledby="lp-community-title">
      <div className="lp-container lp-split lp-split-reverse">
        <div className="lp-split-copy">
          <SectionHead
            id="lp-community-title"
            eyebrow={t('Comunidade')}
            title={t('Sua foto vira quebra-cabeça')}
            text={t('Envie uma foto sua, monte com quem quiser e publique para todo mundo jogar.')}
          />
          <button type="button" className="lp-btn lp-btn-primary" onClick={() => onStart()}>
            {t('Enviar sua foto')}
            <ArrowRightIcon size={18} />
          </button>
        </div>
        <LandingVideo
          name="comunidade"
          label={t('Uma foto enviada vira quebra-cabeça e é publicada')}
        />
      </div>
      {shown.length > 0 && (
        <div className="lp-container">
          <ul className="lp-community">
            {shown.map((puzzle) => (
              <li key={puzzle.id}>
                <button
                  type="button"
                  onClick={() =>
                    onStart({
                      imageId: puzzle.imageId,
                      title: puzzle.title,
                      subtitle: t('por {author}', { author: puzzle.authorName }),
                      thumbUrl: `/api/puzzles/${puzzle.id}/mini`,
                    })
                  }
                >
                  <img src={`/api/puzzles/${puzzle.id}/mini`} alt="" loading="lazy" />
                  <b>{puzzle.title}</b>
                  <span>{t('por {author}', { author: puzzle.authorName })}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** O perfil: níveis, conquistas e sequência (o trecho do ranking ao perfil da Ana). */
export function ProfileSection({ googleLogin }: { googleLogin: boolean }) {
  return (
    <section className="lp-section" aria-labelledby="lp-profile-title">
      <div className="lp-container lp-split">
        <div className="lp-split-copy">
          <SectionHead
            id="lp-profile-title"
            eyebrow={t('Perfil')}
            title={t('Seu perfil, suas conquistas')}
          />
          <Points
            items={[
              t('Suba de nível com os pontos de cada partida.'),
              t('Desbloqueie conquistas e mantenha a sequência de dias.'),
              t('Seus recordes, amigos e partidas salvas num lugar só.'),
            ]}
          />
          {googleLogin && (
            <a className="lp-btn lp-btn-ghost" href="/auth/google">
              {t('Entrar com Google')}
            </a>
          )}
        </div>
        <LandingVideo name="perfil" label={t('O ranking e o perfil de uma jogadora')} />
      </div>
    </section>
  );
}

/** Como funciona, em três passos, cada um com o seu trecho curto. */
export function HowSection() {
  const steps = [
    {
      clip: 'explorar',
      title: t('Escolha a foto e o tamanho'),
      text: t('Do catálogo, da comunidade ou uma sua, de 24 a 1.000 peças.'),
    },
    {
      clip: 'convite',
      title: t('Mande o link'),
      text: t('Cada sala tem um código. Quem recebe o link entra direto, sem instalar nada.'),
    },
    {
      clip: 'junto',
      title: t('Montem juntos'),
      text: t('Todo mundo mexe nas mesmas peças, ao mesmo tempo.'),
    },
  ];
  return (
    <section className="lp-section" aria-labelledby="lp-how-title">
      <div className="lp-container">
        <SectionHead
          id="lp-how-title"
          eyebrow={t('Como funciona')}
          title={t('Da foto à última peça em três passos')}
        />
        <ol className="lp-steps">
          {steps.map((step, i) => (
            <li key={step.clip}>
              <LandingVideo name={step.clip} label={step.title} />
              <span className="lp-step-number">{i + 1}</span>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/** Perguntas frequentes (respostas conferidas com o que o site faz). */
export function FaqSection() {
  const faq = [
    { q: t('É grátis?'), a: t('Sim. É só abrir o site e jogar.') },
    {
      q: t('Precisa instalar alguma coisa?'),
      a: t('Não. Tudo funciona no navegador, inclusive a chamada de voz e vídeo.'),
    },
    {
      q: t('Funciona no celular?'),
      a: t('Funciona. No celular, toque duas vezes numa peça para girá-la.'),
    },
    {
      q: t('Quantas pessoas cabem numa sala?'),
      a: t('Até {n} jogadores montando juntos, no clássico, no Bullet e na batalha (2 contra 2).', {
        n: MAX_PLAYERS,
      }),
    },
    {
      q: t('Preciso de conta?'),
      a: t(
        'Não: dá para jogar como convidado. Entrando com o Google, você tem perfil, amigos, favoritos e partidas salvas.',
      ),
    },
  ];
  return (
    <section className="lp-section" aria-labelledby="lp-faq-title">
      <div className="lp-container lp-faq-wrap">
        <SectionHead id="lp-faq-title" eyebrow={t('Perguntas')} title={t('Perguntas frequentes')} />
        <div className="lp-faq">
          {faq.map((item) => (
            <details key={item.q}>
              <summary>{item.q}</summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

/** O último convite, antes do rodapé. */
export function FinalCta({ onStart }: { onStart: StartPlaying }) {
  return (
    <section className="lp-section" aria-labelledby="lp-cta-title">
      <div className="lp-container">
        <div className="lp-cta">
          <h2 id="lp-cta-title">{t('Junta a galera e abre a primeira sala.')}</h2>
          <p>{t('Leva menos de um minuto.')}</p>
          <button type="button" className="lp-btn lp-btn-primary" onClick={() => onStart()}>
            {t('Criar uma sala')}
            <ArrowRightIcon size={18} />
          </button>
        </div>
      </div>
    </section>
  );
}
