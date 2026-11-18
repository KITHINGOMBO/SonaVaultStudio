export interface EncodedAudioChunk {
  index: number;
  encoding: string;
  data: string;
  byteLength: number;
}

const CHUNK_CHAR_LIMIT = 400000;

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const sliceSize = 0x8000;
  for (let i = 0; i < bytes.length; i += sliceSize) {
    const chunk = bytes.subarray(i, i + sliceSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

async function gzipCompress(data: Uint8Array): Promise<{ bytes: Uint8Array; encoding: string }> {
  if (typeof CompressionStream === 'undefined') {
    return { bytes: data, encoding: 'pcm16-raw-b64' };
  }
  const stream = new CompressionStream('gzip');
  const writer = stream.writable.getWriter();
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  await writer.write(copy);
  await writer.close();
  const compressedBuffer = await new Response(stream.readable).arrayBuffer();
  return { bytes: new Uint8Array(compressedBuffer), encoding: 'pcm16-gzip-b64' };
}

async function gzipDecompress(data: Uint8Array, encoding: string): Promise<Uint8Array> {
  if (encoding === 'pcm16-raw-b64' || typeof DecompressionStream === 'undefined') {
    return data;
  }
  const stream = new DecompressionStream('gzip');
  const writer = stream.writable.getWriter();
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  await writer.write(copy);
  await writer.close();
  const decompressedBuffer = await new Response(stream.readable).arrayBuffer();
  return new Uint8Array(decompressedBuffer);
}

export async function encodeAudioBufferToChunks(buffer: AudioBuffer): Promise<{
  chunks: EncodedAudioChunk[];
  totalBytes: number;
}> {
  const channels = Math.min(2, buffer.numberOfChannels);
  const frameCount = buffer.length;
  const int16 = new Int16Array(frameCount * channels);

  const chData: Float32Array[] = [];
  for (let c = 0; c < channels; c++) {
    chData.push(buffer.getChannelData(c));
  }

  let idx = 0;
  for (let i = 0; i < frameCount; i++) {
    for (let c = 0; c < channels; c++) {
      const clamped = Math.max(-1, Math.min(1, chData[c][i]));
      int16[idx++] = clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
    }
  }

  const rawBytes = new Uint8Array(int16.buffer);
  const { bytes: compressedBytes, encoding } = await gzipCompress(rawBytes);
  const b64 = uint8ToBase64(compressedBytes);

  const chunks: EncodedAudioChunk[] = [];
  for (let pos = 0, index = 0; pos < b64.length; pos += CHUNK_CHAR_LIMIT, index++) {
    const slice = b64.slice(pos, pos + CHUNK_CHAR_LIMIT);
    chunks.push({
      index,
      encoding,
      data: slice,
      byteLength: slice.length,
    });
  }

  return { chunks, totalBytes: compressedBytes.byteLength };
}

export async function decodeChunksToAudioBuffer(
  chunks: { index: number; encoding: string; data: string }[],
  sampleRate: number,
  channels: number,
  ctx: BaseAudioContext
): Promise<AudioBuffer> {
  const sorted = [...chunks].sort((a, b) => a.index - b.index);
  const fullB64 = sorted.map((c) => c.data).join('');
  const encoding = sorted[0]?.encoding ?? 'pcm16-gzip-b64';
  const compressedBytes = base64ToUint8(fullB64);
  const rawBytes = await gzipDecompress(compressedBytes, encoding);

  const alignedBuffer = rawBytes.buffer.slice(rawBytes.byteOffset, rawBytes.byteOffset + rawBytes.byteLength);
  const int16 = new Int16Array(alignedBuffer);
  const chCount = Math.max(1, Math.min(2, channels));
  const frameCount = Math.floor(int16.length / chCount);

  const audioBuffer = ctx.createBuffer(chCount, Math.max(1, frameCount), sampleRate);
  for (let c = 0; c < chCount; c++) {
    const out = audioBuffer.getChannelData(c);
    for (let i = 0; i < frameCount; i++) {
      const sample = int16[i * chCount + c];
      out[i] = sample < 0 ? sample / 0x8000 : sample / 0x7fff;
    }
  }

  return audioBuffer;
}
