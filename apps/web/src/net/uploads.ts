import type { UploadResponse } from '@puzzle/shared';
import { t, translateServerMessage } from '../i18n';

/** O servidor reduz para 2048 de qualquer jeito: reduzir antes poupa o upload (8 MB → ~600 kB). */
const MAX_SIDE = 2048;

/**
 * Prepara a foto no próprio navegador: aplica a rotação do celular, reduz e recodifica em JPEG.
 * Recodificar no canvas também já descarta o EXIF (GPS) antes de a foto sair do aparelho.
 * O servidor não confia nisso e processa tudo de novo.
 */
async function prepareImage(file: File): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error(
      t('Formato não suportado. Use JPG, PNG ou WEBP (no iPhone, exporte como JPG).'),
    );
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error(t('Não foi possível preparar a foto.')))),
      'image/jpeg',
      0.9,
    ),
  );
}

export interface UploadedImage extends UploadResponse {
  /** Pré-visualização local (object URL) para mostrar na grade sem baixar de novo. */
  previewUrl: string;
}

export async function uploadImage(file: File): Promise<UploadedImage> {
  const blob = await prepareImage(file);
  let response: Response;
  try {
    response = await fetch('/api/uploads', {
      method: 'POST',
      body: blob,
      headers: { 'Content-Type': 'image/jpeg' },
    });
  } catch {
    throw new Error(t('Não consegui falar com o servidor.'));
  }
  // O servidor responde { error } em português para 400/413/429/503.
  const body = (await response.json().catch(() => ({}))) as Partial<UploadResponse> & {
    error?: string;
  };
  if (!response.ok || !body.imageId) {
    throw new Error(
      body.error
        ? translateServerMessage(body.error)
        : t('Erro {status} ao enviar a foto.', { status: response.status }),
    );
  }
  return {
    imageId: body.imageId,
    width: body.width!,
    height: body.height!,
    previewUrl: URL.createObjectURL(blob),
  };
}
