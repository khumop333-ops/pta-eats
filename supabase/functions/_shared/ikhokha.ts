export const IKHOKHA_API_BASE = 'https://api.ikhokha.com';
export const IKHOKHA_PAYMENT_PATH = '/public-api/v1/api/payment';
export const IKHOKHA_WEBHOOK_PATH = '/functions/v1/ikhokha-webhook';

/**
 * iKhokha signs the request path plus the exact JSON body string. Their
 * examples escape backslashes, quotes, apostrophes, and NUL characters before
 * calculating the HMAC; whitespace must not be removed.
 */
export function payloadToSign(path: string, rawBody: string) {
  return (path + rawBody)
    .replace(/[\\"']/g, '\\$&')
    .split('\u0000')
    .join('\\0');
}

export async function hmacHex(secret: string, message: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function equalHex(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}
