// Gerado por `pnpm catalog` a partir de catalogo/catalogo.json — não edite à mão.

export interface CatalogImage {
  /** Também é o nome do arquivo: /catalog/<id>.webp e /catalog/<id>-mini.webp */
  id: string;
  title: string;
  /** Crédito/licença da foto ('' quando a foto é sua). */
  credit: string;
  width: number;
  height: number;
}

export const CATALOG: readonly CatalogImage[] = [
  {
    id: 'adrian-botica-bx5kehbqtma-unsplash',
    title: 'Camelos e pirâmide',
    credit: 'Foto de Adrian Botica no Unsplash',
    width: 1365,
    height: 2048,
  },
  {
    id: 'daniel-sessler-jtauce5hyhc-unsplash',
    title: 'Lago entre montanhas',
    credit: 'Foto de Daniel Sessler no Unsplash',
    width: 2048,
    height: 1365,
  },
  {
    id: 'halil-celik-ngzas8ygiq8-unsplash',
    title: 'Lustre do palácio',
    credit: 'Foto de Halil Celik no Unsplash',
    width: 1365,
    height: 2048,
  },
  {
    id: 'julie-gaia-guzal-4zar91cs-fa-unsplash',
    title: 'Veleiros na marina',
    credit: 'Foto de Julie Gaia Guzal no Unsplash',
    width: 1357,
    height: 2048,
  },
  {
    id: 'kevin-flores-lcfpv3o-nqw-unsplash',
    title: 'Vagão de trem',
    credit: 'Foto de Kevin Flores no Unsplash',
    width: 2048,
    height: 1365,
  },
  {
    id: 'lei-hwang-topcl8ywitq-unsplash',
    title: 'Ateliê de pinturas',
    credit: 'Foto de Lei Hwang no Unsplash',
    width: 2048,
    height: 1358,
  },
  {
    id: 'maximilian-wernisch-pt8ndm9xcl4-unsplash',
    title: 'Pagode entre prédios',
    credit: 'Foto de Maximilian Wernisch no Unsplash',
    width: 1358,
    height: 2048,
  },
  {
    id: 'teodor-kuduschiev-xhow2uprxtk-unsplash',
    title: 'Pátio com chafariz',
    credit: 'Foto de Teodor Kuduschiev no Unsplash',
    width: 1365,
    height: 2048,
  },
  {
    id: 'vincent-yap-ilkskz0fqfo-unsplash',
    title: 'Riquixá de bicicleta',
    credit: 'Foto de Vincent Yap no Unsplash',
    width: 2048,
    height: 1324,
  },
  {
    id: 'pexels-adrien-olichon-1257089-4237154',
    title: 'Canal com barcos',
    credit: 'Foto de Adrien Olichon no Pexels',
    width: 2048,
    height: 1365,
  },
  {
    id: 'pexels-andrew-2123337',
    title: 'Parede de quadros',
    credit: 'Foto de Andrew no Pexels',
    width: 2048,
    height: 1365,
  },
  {
    id: 'pexels-carlos-felype-1663973094-27858971',
    title: 'Cúpula dourada',
    credit: 'Foto de Carlos Felype no Pexels',
    width: 1536,
    height: 2048,
  },
  {
    id: 'pexels-magda-ehlers-pexels-35709060',
    title: 'Teto com afrescos',
    credit: 'Foto de Magda Ehlers no Pexels',
    width: 2048,
    height: 1366,
  },
  {
    id: 'pexels-negativespace-34633',
    title: 'Salão do museu',
    credit: 'Foto de Negativespace no Pexels',
    width: 2048,
    height: 1365,
  },
  {
    id: 'pexels-pluyar-37669151',
    title: 'Casas de Amsterdã',
    credit: 'Foto de Pluyar no Pexels',
    width: 2048,
    height: 1280,
  },
  {
    id: 'pexels-recep-klc-2161306727-39863320',
    title: 'Lambreta na praça',
    credit: 'Foto de Recep Klc no Pexels',
    width: 2048,
    height: 1279,
  },
  {
    id: 'pexels-regan-dsouza-1315522347-38623658',
    title: 'Afresco no céu',
    credit: 'Foto de Regan Dsouza no Pexels',
    width: 2048,
    height: 1365,
  },
  {
    id: 'pexels-taylor-thompson-865581658-32469460',
    title: 'Fachadas coloridas',
    credit: 'Foto de Taylor Thompson no Pexels',
    width: 2048,
    height: 1365,
  },
  {
    id: 'pexels-wellingtonsilva-14638945',
    title: 'Diante do quadro',
    credit: 'Foto de Wellingtonsilva no Pexels',
    width: 2048,
    height: 1365,
  },
  {
    id: 'barcos-atracados',
    title: 'Barcos atracados',
    credit: '',
    width: 2048,
    height: 1536,
  },
  {
    id: 'canal-com-barcos-no-meio-da-cidade',
    title: 'Canal com barcos no meio da cidade',
    credit: '',
    width: 2048,
    height: 1366,
  },
  {
    id: 'entardecer-na-cidade',
    title: 'Entardecer na cidade',
    credit: '',
    width: 2048,
    height: 1365,
  },
  {
    id: 'ponte-sobre-a-agua-na-cidade',
    title: 'Ponte sobre a água na cidade',
    credit: '',
    width: 2048,
    height: 1456,
  },
];

export function findCatalogImage(id: string): CatalogImage | undefined {
  return CATALOG.find((image) => image.id === id);
}
