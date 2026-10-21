import { crc32 } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { UPLOAD_LIMITS } from '@puzzle/shared';
import { processUpload, UploadError } from './processUpload';

/** Foto colorida de teste; `orientation: 6` simula o celular deitado. */
async function photo(width: number, height: number, { orientation = 1, gps = false } = {}) {
  const image = sharp({ create: { width, height, channels: 3, background: '#4a7' } })
    .withMetadata({ orientation })
    .withExif(gps ? { IFD3: { GPSLatitudeRef: 'S', GPSLatitude: '7/1 7/1 0/1' } } : {});
  return image.jpeg().toBuffer();
}

/**
 * PNG minúsculo cujo cabeçalho declara 20000×20000 (400 MP): a "bomba de descompressão".
 * Montado à mão: assinatura + bloco IHDR (com CRC) + IEND, sem nenhum pixel de verdade.
 */
function decompressionBomb(): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(20_000, 0); // largura
  header.writeUInt32BE(20_000, 4); // altura
  header.writeUInt8(8, 8); // bits por canal
  header.writeUInt8(2, 9); // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

describe('processUpload', () => {
  it('aplica a rotação do celular, reduz para 2048 px e apaga o EXIF (inclusive GPS)', async () => {
    const input = await photo(3000, 2000, { orientation: 6, gps: true });
    expect((await sharp(input).metadata()).exif).toBeDefined(); // o original tem EXIF

    const { data, width, height } = await processUpload(input);
    const output = await sharp(data).metadata();
    expect({ width, height }).toEqual({ width: 1365, height: 2048 }); // girou: agora em pé
    expect(output.format).toBe('webp');
    expect(output.exif).toBeUndefined();
    expect(output.orientation).toBeUndefined();
  });

  it('não aumenta foto que já é pequena', async () => {
    const { width, height } = await processUpload(await photo(800, 600));
    expect({ width, height }).toEqual({ width: 800, height: 600 });
  });

  it('recusa o que não é imagem, mesmo que diga ser', async () => {
    const fake = Buffer.from('<script>alert(1)</script> com cara de JPG');
    await expect(processUpload(fake)).rejects.toThrow(UploadError);
  });

  it('recusa arquivo vazio e arquivo grande demais', async () => {
    await expect(processUpload(Buffer.alloc(0))).rejects.toThrow(UploadError);
    await expect(processUpload(Buffer.alloc(UPLOAD_LIMITS.maxBytes + 1))).rejects.toThrow(
      UploadError,
    );
  });

  it('recusa bomba de descompressão sem tentar alocar os 400 megapixels', async () => {
    await expect(processUpload(decompressionBomb())).rejects.toThrow(UploadError);
  });

  it('recusa foto pequena demais e panorâmica extrema', async () => {
    await expect(processUpload(await photo(300, 300))).rejects.toThrow(/pequena/);
    await expect(processUpload(await photo(4000, 1000))).rejects.toThrow(/comprida/);
  });
});
