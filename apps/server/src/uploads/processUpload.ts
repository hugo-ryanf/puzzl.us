import sharp, { type OutputInfo } from 'sharp';
import { UPLOAD_LIMITS } from '@puzzle/shared';

/** Mesmo limite do catálogo: acima disso só pesa na GPU de quem joga. */
const MAX_SIDE = 2048;
/**
 * Teto de pixels da imagem DECODIFICADA (~50 MP, mais que qualquer celular). Barra "bombas de
 * descompressão": arquivos pequenos que se expandem para gigapixels e derrubam o servidor.
 */
const MAX_INPUT_PIXELS = 50_000_000;

/** Erro com mensagem para mostrar ao jogador (vira HTTP 400). */
export class UploadError extends Error {}

export interface ProcessedUpload {
  data: Buffer;
  width: number;
  height: number;
}

/**
 * Nunca confia no arquivo recebido: decodifica com o sharp (se não for imagem, falha), aplica a
 * rotação do celular, reduz e RECODIFICA em WebP — isso descarta EXIF/GPS e qualquer conteúdo
 * embutido no arquivo original.
 */
export async function processUpload(input: Buffer): Promise<ProcessedUpload> {
  if (input.length === 0) throw new UploadError('Arquivo vazio.');
  if (input.length > UPLOAD_LIMITS.maxBytes) throw new UploadError('Arquivo grande demais.');

  let result: { data: Buffer; info: OutputInfo };
  try {
    result = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' })
      .rotate()
      .resize(MAX_SIDE, MAX_SIDE, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw new UploadError('Não é uma imagem válida (use JPG, PNG ou WEBP).');
  }

  const { width, height } = result.info;
  if (Math.min(width, height) < UPLOAD_LIMITS.minSide) {
    throw new UploadError(
      `Imagem pequena demais: o menor lado precisa ter ${UPLOAD_LIMITS.minSide} px.`,
    );
  }
  if (Math.max(width, height) / Math.min(width, height) > UPLOAD_LIMITS.maxAspect) {
    throw new UploadError('Imagem comprida demais (panorâmica): as peças ficariam esticadas.');
  }
  return { data: result.data, width, height };
}
