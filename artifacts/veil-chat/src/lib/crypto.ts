const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type RoomMetadata = {
  kind: 'channel' | 'direct';
  name: string;
  topic: string | null;
};

export type MessagePayload = {
  senderAlias: string;
  text: string;
};

function toBase64(bytes: Uint8Array) {
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function fromBase64(value: string) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

export function createRoomKey() {
  return toBase64(crypto.getRandomValues(new Uint8Array(32)));
}

async function importRoomKey(encoded: string) {
  return crypto.subtle.importKey('raw', fromBase64(encoded), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

function roomContext(type: 'metadata' | 'message', roomId: string) {
  return encoder.encode(`veil-chat:v2:${type}:${roomId}`);
}

async function encryptPayload(
  payload: string,
  encodedKey: string,
  roomId: string,
  type: 'metadata' | 'message',
) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await importRoomKey(encodedKey);
  const data = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: roomContext(type, roomId) },
    key,
    encoder.encode(payload),
  );
  return { ciphertext: toBase64(new Uint8Array(data)), iv: toBase64(iv) };
}

async function decryptPayload(
  ciphertext: string,
  iv: string,
  encodedKey: string,
  roomId: string,
  type: 'metadata' | 'message',
) {
  const key = await importRoomKey(encodedKey);
  const data = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(iv), additionalData: roomContext(type, roomId) },
    key,
    fromBase64(ciphertext),
  );
  return decoder.decode(data);
}

export function encryptRoomMetadata(metadata: RoomMetadata, encodedKey: string, roomId: string) {
  return encryptPayload(JSON.stringify(metadata), encodedKey, roomId, 'metadata');
}

export async function decryptRoomMetadata(
  ciphertext: string,
  iv: string,
  encodedKey: string,
  roomId: string,
): Promise<RoomMetadata> {
  const value: unknown = JSON.parse(await decryptPayload(ciphertext, iv, encodedKey, roomId, 'metadata'));
  if (
    !value ||
    typeof value !== 'object' ||
    !('kind' in value) ||
    !['channel', 'direct'].includes(String(value.kind)) ||
    !('name' in value) ||
    typeof value.name !== 'string' ||
    !('topic' in value) ||
    !(typeof value.topic === 'string' || value.topic === null)
  ) {
    throw new Error('Invalid encrypted room metadata');
  }
  return value as RoomMetadata;
}

export function encryptMessage(
  text: string,
  senderAlias: string,
  encodedKey: string,
  roomId: string,
) {
  return encryptPayload(JSON.stringify({ text, senderAlias }), encodedKey, roomId, 'message');
}

export async function decryptMessage(
  ciphertext: string,
  iv: string,
  encodedKey: string,
  roomId: string,
): Promise<MessagePayload> {
  try {
    const value: unknown = JSON.parse(await decryptPayload(ciphertext, iv, encodedKey, roomId, 'message'));
    if (
      value &&
      typeof value === 'object' &&
      'text' in value &&
      typeof value.text === 'string' &&
      'senderAlias' in value &&
      typeof value.senderAlias === 'string'
    ) {
      return { text: value.text, senderAlias: value.senderAlias };
    }
    throw new Error('Invalid encrypted message');
  } catch (currentFormatError) {
    try {
      const legacy = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: fromBase64(iv),
          additionalData: encoder.encode(`veil-chat:v1:${roomId}`),
        },
        await importRoomKey(encodedKey),
        fromBase64(ciphertext),
      );
      return { text: decoder.decode(legacy), senderAlias: 'Anonim' };
    } catch {
      throw currentFormatError;
    }
  }
}
