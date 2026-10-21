/**
 * pnpm catalog — monta o catálogo de imagens a partir de catalogo/originais/.
 *
 * - catalogo/catalogo.json é a lista oficial (título e crédito editáveis à mão). Fotos novas na
 *   pasta entram sozinhas; para tirar uma foto do jogo, tire o original da pasta (subpastas
 *   são ignoradas) e apague a entrada dela desse arquivo.
 * - Cada foto vira apps/web/public/catalog/<id>.webp (lado maior ≤ 2048 px) e <id>-mini.webp.
 *   A rotação do celular é aplicada e os metadados EXIF (inclusive GPS) são descartados.
 * - packages/shared/src/catalog.ts é gerado com id, título, crédito e tamanho de cada imagem.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { format, resolveConfig } from 'prettier';
import sharp from 'sharp';

const ROOT = resolve(import.meta.dirname, '..');
const ORIGINALS = join(ROOT, 'catalogo', 'originais');
const MANIFEST = join(ROOT, 'catalogo', 'catalogo.json');
const OUTPUT = join(ROOT, 'apps', 'web', 'public', 'catalog');
const GENERATED = join(ROOT, 'packages', 'shared', 'src', 'catalog.ts');

const MAX_SIDE = 2048;
const MINI_WIDTH = 480;
const MIN_RECOMMENDED_SIDE = 1600;
const EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

/** Como aparece em catalogo/catalogo.json (em português: é o arquivo que você edita). */
interface ManifestEntry {
  arquivo: string;
  titulo: string;
  credito: string;
}

/** "Pôr-do-sol em João_Pessoa.JPG" → "por-do-sol-em-joao-pessoa" */
function slugify(fileName: string): string {
  return basename(fileName, extname(fileName))
    .normalize('NFD') // separa "ô" em "o" + acento...
    .replace(/\p{Diacritic}/gu, '') // ...e remove o acento
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** "por-do-sol_em-joao-pessoa.jpg" → "Por do sol em joao pessoa" */
function titleFromFile(fileName: string): string {
  const words = basename(fileName, extname(fileName)).replace(/[-_]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** ["adrien", "olichon"] → "Adrien Olichon" */
function personName(words: string[]): string {
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

/**
 * Fotos baixadas do Unsplash/Pexels já vêm com o autor no nome do arquivo, e assim o crédito
 * (atribuição) já nasce preenchido; dá para ajustar no catalogo.json.
 * - Unsplash: "adrian-botica-bx5kehBQTMA-unsplash.jpg" → "Foto de Adrian Botica no Unsplash"
 * - Pexels: "pexels-adrien-olichon-1257089-4237154.jpg" → "Foto de Adrien Olichon no Pexels"
 *   (os números são ids; às vezes o autor vem seguido de "pexels" de novo, que descartamos).
 */
function creditFromFile(fileName: string): string {
  const name = basename(fileName, extname(fileName)).replace(/\s*\(\d+\)$/, ''); // "foto (1)"
  const unsplash = /^(.+)-[^-]+-unsplash$/i.exec(name);
  if (unsplash) return `Foto de ${personName(unsplash[1]!.split('-'))} no Unsplash`;
  const pexels = /^pexels-(.+)$/i.exec(name);
  if (pexels) {
    const words = pexels[1]!.split('-');
    const firstId = words.findIndex((word) => /^\d+$/.test(word));
    const author = (firstId === -1 ? words : words.slice(0, firstId)).filter(
      (word) => word.toLowerCase() !== 'pexels',
    );
    if (author.length > 0) return `Foto de ${personName(author)} no Pexels`;
  }
  return '';
}

function readManifest(): ManifestEntry[] {
  if (!existsSync(MANIFEST)) return [];
  return JSON.parse(readFileSync(MANIFEST, 'utf8')) as ManifestEntry[];
}

async function main() {
  mkdirSync(ORIGINALS, { recursive: true });
  mkdirSync(OUTPUT, { recursive: true });

  // 1) Lista oficial: o que já estava no manifesto + fotos novas da pasta.
  const manifest = readManifest();
  const originals = readdirSync(ORIGINALS).filter((f) => EXTENSIONS.has(extname(f).toLowerCase()));
  for (const file of originals) {
    if (!manifest.some((entry) => entry.arquivo === file)) {
      manifest.push({ arquivo: file, titulo: titleFromFile(file), credito: creditFromFile(file) });
      console.log(`+ nova foto: ${file}`);
    }
  }
  for (const file of readdirSync(ORIGINALS)) {
    if (!EXTENSIONS.has(extname(file).toLowerCase())) {
      console.warn(`! ignorado (use JPG, PNG ou WEBP): ${file}`);
    }
  }

  // 2) Processa cada foto (ou reaproveita a versão já processada se o original não estiver aqui).
  const seen = new Set<string>();
  const catalog = [];
  for (const entry of manifest) {
    const id = slugify(entry.arquivo);
    if (!id || seen.has(id))
      throw new Error(`nome de arquivo gera id vazio ou repetido: ${entry.arquivo}`);
    seen.add(id);

    const source = join(ORIGINALS, entry.arquivo);
    const full = join(OUTPUT, `${id}.webp`);
    if (existsSync(source)) {
      // rotate() sem argumento aplica a orientação do EXIF; sem withMetadata() o EXIF é descartado.
      const image = sharp(source).rotate();
      await image
        .clone()
        .resize(MAX_SIDE, MAX_SIDE, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 85 })
        .toFile(full);
      await image
        .clone()
        .resize({ width: MINI_WIDTH, withoutEnlargement: true })
        .webp({ quality: 75 })
        .toFile(join(OUTPUT, `${id}-mini.webp`));
    } else if (existsSync(full)) {
      console.warn(`! original ausente, mantendo a versão processada: ${entry.arquivo}`);
    } else {
      throw new Error(`foto do catálogo sem original nem versão processada: ${entry.arquivo}`);
    }

    const { width, height } = await sharp(full).metadata();
    if (Math.max(width, height) < MIN_RECOMMENDED_SIDE) {
      console.warn(`! ${entry.arquivo}: ${width}×${height} é pequena; peças vão ficar borradas`);
    }
    if (height > width) {
      console.warn(`! ${entry.arquivo}: está na vertical; funciona, mas cabe pior na tela`);
    }
    catalog.push({ id, title: entry.titulo, credit: entry.credito, width, height });
  }

  if (catalog.length === 0) {
    throw new Error('catálogo vazio: coloque fotos em catalogo/originais/ e rode de novo');
  }

  // 3) Remove saídas de fotos que saíram do manifesto.
  for (const file of readdirSync(OUTPUT)) {
    const id = file.replace(/(-mini)?\.webp$/, '');
    if (!seen.has(id)) {
      rmSync(join(OUTPUT, file));
      console.log(`- removido: ${file}`);
    }
  }

  // 4) Grava o manifesto (com as fotos novas) e o catálogo tipado do shared, já formatado.
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  const source = `// Gerado por \`pnpm catalog\` a partir de catalogo/catalogo.json — não edite à mão.

export interface CatalogImage {
  /** Também é o nome do arquivo: /catalog/<id>.webp e /catalog/<id>-mini.webp */
  id: string;
  title: string;
  /** Crédito/licença da foto ('' quando a foto é sua). */
  credit: string;
  width: number;
  height: number;
}

export const CATALOG: readonly CatalogImage[] = ${JSON.stringify(catalog, null, 2)};

export function findCatalogImage(id: string): CatalogImage | undefined {
  return CATALOG.find((image) => image.id === id);
}
`;
  const prettierConfig = await resolveConfig(GENERATED);
  writeFileSync(GENERATED, await format(source, { ...prettierConfig, filepath: GENERATED }));

  console.log(`\ncatálogo: ${catalog.length} imagem(ns) → ${OUTPUT}`);
  for (const image of catalog) console.log(`  ${image.id} (${image.width}×${image.height})`);
}

await main();
