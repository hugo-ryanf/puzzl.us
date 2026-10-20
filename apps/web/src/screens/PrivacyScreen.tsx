import { ArrowLeftIcon } from '../ui/icons';

/** Onde pedir para apagar dados ou tirar dúvidas (o repositório é público). */
const CONTACT_URL = 'https://github.com/hugo-ryanf/puzzl.us/issues';

/**
 * Política de privacidade (exigida pelo Google para liberar o login a qualquer pessoa, e pela
 * LGPD). Descreve só o que o código realmente guarda; ao mudar o que se guarda, mude aqui.
 */
export function PrivacyScreen() {
  return (
    <div className="main standalone">
      <a className="btn" href="/">
        <ArrowLeftIcon size={18} />
        Voltar ao jogo
      </a>

      <article className="legal">
        <h1>Política de privacidade</h1>
        <p className="legal-updated">Atualizada em 21 de outubro de 2026</p>

        <p>
          O <strong>puzzl.us</strong> é um jogo de quebra-cabeça on-line, gratuito e sem anúncios,
          feito por um estudante como projeto pessoal. Guardamos o mínimo necessário para o jogo
          funcionar. Não vendemos dados, não usamos ferramentas de rastreamento nem de publicidade.
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
            <strong>Partidas:</strong> foto jogada, número de peças, tempo, data e os apelidos de
            quem jogou, para montar o ranking.
          </li>
          <li>
            <strong>Fotos enviadas:</strong> antes de guardar, removemos os metadados da imagem
            (inclusive localização/GPS). A foto é apagada depois de 7 dias sem ser usada em nenhuma
            sala.
          </li>
          <li>
            <strong>Salas em andamento:</strong> a posição das peças é salva para a sala sobreviver
            a um reinício do servidor e apagada em até 24 horas.
          </li>
        </ul>

        <h2>Cookies e armazenamento no navegador</h2>
        <ul>
          <li>
            <strong>Sessão de login</strong> (cookie <code>sid</code>): mantém você conectado por
            até 30 dias. No nosso banco fica só uma versão cifrada (hash) dele.
          </li>
          <li>
            <strong>Login em andamento</strong> (cookies <code>oauth_state</code> e{' '}
            <code>oauth_verifier</code>): duram 10 minutos e protegem o login contra fraude.
          </li>
          <li>
            <strong>Navegador</strong> (localStorage/sessionStorage): seu apelido e o identificador
            de convidado, para não precisar digitar de novo, e a sala atual, para voltar a ela se a
            página recarregar.
          </li>
        </ul>

        <h2>Voz e câmera</h2>
        <p>
          A chamada de voz e a câmera são opcionais e transmitidas em tempo real só para quem está
          na mesma sala. <strong>Nada é gravado.</strong>
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
        </ul>

        <h2>Seus direitos</h2>
        <p>
          Conforme a LGPD, você pode pedir para ver, corrigir ou apagar seus dados. Faça o pedido
          pelo nosso{' '}
          <a href={CONTACT_URL} target="_blank" rel="noreferrer">
            canal de contato
          </a>
          ; respondemos o quanto antes. Você também pode sair da conta a qualquer momento pela barra
          lateral e revogar o acesso do puzzl.us na sua conta Google.
        </p>
      </article>
    </div>
  );
}
