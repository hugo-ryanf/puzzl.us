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
];

export function findCatalogImage(id: string): CatalogImage | undefined {
  return CATALOG.find((image) => image.id === id);
}
