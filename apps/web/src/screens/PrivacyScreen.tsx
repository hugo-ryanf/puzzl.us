import { useState } from 'react';
import { locale, t } from '../i18n';
import { isRecordingOptedOut, setRecordingOptOut } from '../net/analytics';
import { ArrowLeftIcon } from '../ui/icons';

/** Onde pedir para apagar dados ou tirar dúvidas (o repositório é público). */
const CONTACT_URL = 'https://github.com/hugo-ryanf/puzzl.us/issues';

/** Ligar ou desligar o registro de uso (PostHog) neste navegador. */
function RecordingChoice({ on, off, stopped }: { on: string; off: string; stopped: string }) {
  const [out, setOut] = useState(isRecordingOptedOut);
  const toggle = () => {
    setRecordingOptOut(!out);
    setOut(!out);
  };
  return (
    <p className="legal-choice">
      {out && <span>{stopped} </span>}
      <button type="button" className="btn" onClick={toggle}>
        {out ? on : off}
      </button>
    </p>
  );
}

/**
 * Política de privacidade (exigida pelo Google para liberar o login a qualquer pessoa, e pela
 * LGPD). Descreve só o que o código realmente guarda; ao mudar o que se guarda, mude aqui, nos
 * dois idiomas. O texto legal fica inteiro por idioma, em vez de frase por frase no dicionário.
 */
export function PrivacyScreen() {
  return (
    <div className="main standalone">
      <a className="btn" href="/">
        <ArrowLeftIcon size={18} />
        {t('Voltar ao jogo')}
      </a>

      {locale === 'en' ? <PolicyEn /> : <PolicyPt />}
    </div>
  );
}

function PolicyPt() {
  return (
    <article className="legal">
      <h1>Política de privacidade</h1>
      <p className="legal-updated">Atualizada em 30 de outubro de 2026</p>

      <p>
        O <strong>puzzl.us</strong> é um jogo de quebra-cabeça on-line, gratuito e sem anúncios,
        feito por um estudante como projeto pessoal. Guardamos o mínimo necessário para o jogo
        funcionar e para entender como o site é usado. Não vendemos dados e não usamos publicidade.
      </p>

      <h2>O que guardamos</h2>
      <ul>
        <li>
          <strong>Sem conta (convidado):</strong> o apelido que você digita e um identificador
          aleatório criado no seu navegador, que serve para o ranking reconhecer suas partidas.
        </li>
        <li>
          <strong>Com login do Google:</strong> o identificador da sua conta Google, seu nome e o
          endereço da sua foto de perfil, além de um código de amigo gerado por nós.{' '}
          <strong>Não guardamos seu e-mail</strong>: ele é usado só no momento do login, para
          reconhecer quem administra o site.
        </li>
        <li>
          <strong>Partidas:</strong> foto jogada, número de peças, tempo, data e os apelidos de quem
          jogou, para montar o ranking.
        </li>
        <li>
          <strong>Fotos enviadas:</strong> antes de guardar, removemos os metadados da imagem
          (inclusive localização/GPS). A foto é apagada depois de 7 dias sem ser usada em nenhuma
          sala.
        </li>
        <li>
          <strong>Salas em andamento:</strong> a posição das peças é salva para a sala sobreviver a
          um reinício do servidor e apagada em até 24 horas.
        </li>
      </ul>

      <h2>Cookies e armazenamento no navegador</h2>
      <ul>
        <li>
          <strong>Sessão de login</strong> (cookie <code>sid</code>): mantém você conectado por até
          30 dias. No nosso banco fica só uma versão cifrada (hash) dele.
        </li>
        <li>
          <strong>Login em andamento</strong> (cookies <code>oauth_state</code> e{' '}
          <code>oauth_verifier</code>): duram 10 minutos e protegem o login contra fraude.
        </li>
        <li>
          <strong>Navegador</strong> (localStorage/sessionStorage): seu apelido e o identificador de
          convidado, para não precisar digitar de novo, o idioma escolhido, e a sala atual, para
          voltar a ela se a página recarregar.
        </li>
        <li>
          <strong>Análise de uso</strong> (cookie e localStorage do PostHog, que começam com{' '}
          <code>ph_</code>): um identificador aleatório da visita, para juntar as páginas vistas na
          mesma sessão.
        </li>
      </ul>

      <h2>Análise de uso</h2>
      <p>
        Para melhorar o jogo, usamos o <strong>PostHog</strong> para registrar como o site é usado:
        páginas vistas, cliques, ações do jogo (como criar sala e concluir partida), desempenho e
        gravações das sessões (o que aparece na tela e os movimentos do mouse). O que você digita
        fica mascarado, a mesa do jogo não é gravada, e a chamada de voz e a câmera nunca entram.
        Com login, as visitas ficam ligadas à identificação interna da sua conta, nunca ao seu
        e-mail.
      </p>
      <RecordingChoice
        off="Não registrar minhas visitas"
        on="Voltar a registrar minhas visitas"
        stopped="O registro está desligado neste navegador."
      />

      <h2>Voz e câmera</h2>
      <p>
        A chamada de voz e a câmera são opcionais e transmitidas em tempo real só para quem está na
        mesma sala. <strong>Nada é gravado.</strong>
      </p>

      <h2>Serviços que usamos</h2>
      <ul>
        <li>
          <strong>Google</strong> — login com conta Google.
        </li>
        <li>
          <strong>Render</strong> — hospedagem do site e do servidor do jogo.
        </li>
        <li>
          <strong>Neon</strong> — banco de dados (contas, partidas, fotos enviadas).
        </li>
        <li>
          <strong>LiveKit</strong> — transmissão da chamada de voz e da câmera.
        </li>
        <li>
          <strong>PostHog</strong> — análise de uso e gravação das sessões (servidores nos EUA).
        </li>
      </ul>

      <h2>Seus direitos</h2>
      <p>
        Conforme a LGPD, você pode pedir para ver, corrigir ou apagar seus dados. Faça o pedido pelo
        nosso{' '}
        <a href={CONTACT_URL} target="_blank" rel="noreferrer">
          canal de contato
        </a>
        ; respondemos o quanto antes. Você também pode sair da conta a qualquer momento pela barra
        lateral e revogar o acesso do puzzl.us na sua conta Google.
      </p>
    </article>
  );
}

function PolicyEn() {
  return (
    <article className="legal">
      <h1>Privacy policy</h1>
      <p className="legal-updated">Updated on October 30, 2026</p>

      <p>
        <strong>puzzl.us</strong> is a free, ad-free online jigsaw puzzle game, made by a student as
        a personal project. We keep the minimum needed for the game to work and to understand how
        the site is used. We don't sell data and we don't use advertising.
      </p>

      <h2>What we store</h2>
      <ul>
        <li>
          <strong>Without an account (guest):</strong> the nickname you type and a random identifier
          created in your browser, which lets the ranking recognize your games.
        </li>
        <li>
          <strong>With Google sign-in:</strong> your Google account identifier, your name and the
          address of your profile picture, plus a friend code we generate.{' '}
          <strong>We don't store your email</strong>: it's only used at sign-in, to recognize who
          administers the site.
        </li>
        <li>
          <strong>Games:</strong> the photo played, number of pieces, time, date and the nicknames
          of those who played, to build the ranking.
        </li>
        <li>
          <strong>Uploaded photos:</strong> before storing them, we remove the image metadata
          (including location/GPS). A photo is deleted after 7 days without being used in any room.
        </li>
        <li>
          <strong>Rooms in progress:</strong> piece positions are saved so the room survives a
          server restart, and deleted within 24 hours.
        </li>
      </ul>

      <h2>Cookies and browser storage</h2>
      <ul>
        <li>
          <strong>Sign-in session</strong> (<code>sid</code> cookie): keeps you signed in for up to
          30 days. Our database only holds an encrypted version (hash) of it.
        </li>
        <li>
          <strong>Sign-in in progress</strong> (<code>oauth_state</code> and{' '}
          <code>oauth_verifier</code> cookies): last 10 minutes and protect sign-in against fraud.
        </li>
        <li>
          <strong>Browser</strong> (localStorage/sessionStorage): your nickname and guest
          identifier, so you don't have to type them again, your chosen language, and the current
          room, so you can return to it if the page reloads.
        </li>
        <li>
          <strong>Usage analytics</strong> (PostHog cookie and localStorage, starting with{' '}
          <code>ph_</code>): a random visit identifier, to group the pages seen in the same session.
        </li>
      </ul>

      <h2>Usage analytics</h2>
      <p>
        To improve the game, we use <strong>PostHog</strong> to record how the site is used: pages
        viewed, clicks, game actions (such as creating a room and finishing a game), performance and
        session recordings (what appears on screen and mouse movements). What you type is masked,
        the game board is not recorded, and voice chat and camera are never included. When signed
        in, visits are linked to your account's internal identifier, never to your email.
      </p>
      <RecordingChoice
        off="Don't record my visits"
        on="Record my visits again"
        stopped="Recording is off in this browser."
      />

      <h2>Voice and camera</h2>
      <p>
        Voice chat and camera are optional and streamed in real time only to people in the same
        room. <strong>Nothing is recorded.</strong>
      </p>

      <h2>Services we use</h2>
      <ul>
        <li>
          <strong>Google</strong> — sign-in with a Google account.
        </li>
        <li>
          <strong>Render</strong> — hosting for the site and the game server.
        </li>
        <li>
          <strong>Neon</strong> — database (accounts, games, uploaded photos).
        </li>
        <li>
          <strong>LiveKit</strong> — streaming for voice chat and camera.
        </li>
        <li>
          <strong>PostHog</strong> — usage analytics and session recording (servers in the US).
        </li>
      </ul>

      <h2>Your rights</h2>
      <p>
        Under Brazil's data protection law (LGPD), you can ask to see, correct or delete your data.
        Make your request through our{' '}
        <a href={CONTACT_URL} target="_blank" rel="noreferrer">
          contact channel
        </a>
        ; we'll reply as soon as possible. You can also sign out at any time from the sidebar and
        revoke puzzl.us's access in your Google account.
      </p>
    </article>
  );
}
