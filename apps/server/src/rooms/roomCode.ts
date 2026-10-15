import { randomInt } from 'node:crypto';
import { matchMaker } from '@colyseus/core';

/** Sem O/0, I/1/L: o código é lido em voz alta e digitado por amigos. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const LENGTH = 5;

export function randomRoomCode(): string {
  return Array.from({ length: LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
}

/**
 * 31^5 ≈ 28 milhões de códigos: colisão é rara, mas conferimos mesmo assim. `isReserved` barra
 * códigos que não estão em uso agora mas podem voltar (sala salva num snapshot).
 */
export async function uniqueRoomCode(
  isReserved: (code: string) => Promise<boolean> = async () => false,
): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = randomRoomCode();
    if (!(await matchMaker.getRoomById(code)) && !(await isReserved(code))) return code;
  }
  throw new Error('não foi possível gerar um código de sala livre');
}
