/**
 * Converte um Uint8Array para uma string base64.
 */
export function toBase64(arr: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < arr.byteLength; i++) {
    bin += String.fromCharCode(arr[i]);
  }
  return btoa(bin);
}

/**
 * Converte uma string base64 para um Uint8Array.
 */
export function fromBase64(str: string): Uint8Array {
  return Uint8Array.from(atob(str), c => c.charCodeAt(0));
}
