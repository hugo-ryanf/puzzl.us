/** Lado maior máximo da imagem do puzzle: acima disso só pesa na GPU sem ganho visível. */
const MAX_IMAGE_SIDE = 2048;

/** Imagem colorida gerada por código, para testar sem precisar de arquivo. */
export function createSampleImage(width = 1600, height = 1000): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#1d3557');
  gradient.addColorStop(0.5, '#457b9d');
  gradient.addColorStop(1, '#e9c46a');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  // Formas variadas deixam cada região diferente, senão as peças ficam impossíveis de distinguir.
  for (let i = 0; i < 90; i++) {
    ctx.beginPath();
    ctx.arc(
      Math.random() * width,
      Math.random() * height,
      20 + Math.random() * 120,
      0,
      Math.PI * 2,
    );
    ctx.fillStyle = `hsla(${Math.random() * 360}, 70%, 60%, 0.55)`;
    ctx.fill();
  }

  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.font = `bold ${Math.round(height / 6)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Quebra-cabeça', width / 2, height / 2);

  return canvas;
}

/** Lê uma foto do computador e reduz para no máximo MAX_IMAGE_SIDE pixels no lado maior. */
export async function loadImageFile(file: File): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas;
}
