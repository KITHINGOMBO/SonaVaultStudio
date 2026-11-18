import { Mp3Encoder } from '@breezystack/lamejs';
import type { ExportFormat, MasterSettings, StudioTrack } from '../types/studio';
import { createStudioReverbImpulse } from './dspEngine';

export function dbToGain(db: number): number {
  if (db <= -59.5) return 0;
  return Math.pow(10, db / 20);
}

export function computeProjectDurationSec(tracks: StudioTrack[]): number {
  let maxEnd = 0;
  for (const t of tracks) {
    const activeDur = Math.max(0, t.trimEndSec - t.trimStartSec);
    const end = t.startOffsetSec + activeDur;
    if (end > maxEnd) maxEnd = end;
  }
  return Math.max(1, maxEnd);
}

export async function renderMasterOffline(
  tracks: StudioTrack[],
  master: MasterSettings,
  options: {
    sampleRate: number;
    includeMasterChain: boolean;
    normalizeToTargetLufs: boolean;
    bpm: number;
  }
): Promise<AudioBuffer> {
  const durationSec = computeProjectDurationSec(tracks);
  const sampleRate = options.sampleRate;
  const totalFrames = Math.ceil((durationSec + 1.5) * sampleRate); // +1.5s reverb/delay tail
  const offline = new OfflineAudioContext(2, totalFrames, sampleRate);

  const anySolo = tracks.some((t) => t.solo);
  const activeTracks = tracks.filter((t) => {
    if (!t.rawBuffer && !t.cleanedBuffer) return false;
    if (anySolo) return t.solo;
    return !t.muted;
  });

  // Master bus summing node
  const mixBus = offline.createGain();
  mixBus.gain.value = 1;

  // Shared Reverb & Delay FX buses
  const reverbConvolver = offline.createConvolver();
  reverbConvolver.buffer = createStudioReverbImpulse(offline, 1.8, 2.5);
  const reverbReturn = offline.createGain();
  reverbReturn.gain.value = 0.85;
  reverbConvolver.connect(reverbReturn);
  reverbReturn.connect(mixBus);

  const delayNode = offline.createDelay(2.0);
  delayNode.delayTime.value = Math.min(1.5, 60 / Math.max(40, options.bpm) / 2); // 8th note sync
  const delayFeedback = offline.createGain();
  delayFeedback.gain.value = 0.28;
  const delayTone = offline.createBiquadFilter();
  delayTone.type = 'lowpass';
  delayTone.frequency.value = 4200;
  const delayReturn = offline.createGain();
  delayReturn.gain.value = 0.65;

  delayNode.connect(delayTone);
  delayTone.connect(delayFeedback);
  delayFeedback.connect(delayNode);
  delayTone.connect(delayReturn);
  delayReturn.connect(mixBus);

  for (const track of activeTracks) {
    const buf =
      track.aiDenoiseEnabled && track.cleanedBuffer
        ? track.cleanedBuffer
        : track.rawBuffer ?? track.cleanedBuffer;
    if (!buf) continue;

    const src = offline.createBufferSource();
    src.buffer = buf;

    const eqLow = offline.createBiquadFilter();
    eqLow.type = 'lowshelf';
    eqLow.frequency.value = 110;
    eqLow.gain.value = track.eqLowDb;

    const eqMid = offline.createBiquadFilter();
    eqMid.type = 'peaking';
    eqMid.frequency.value = 1200;
    eqMid.Q.value = 1.0;
    eqMid.gain.value = track.eqMidDb;

    const eqHigh = offline.createBiquadFilter();
    eqHigh.type = 'highshelf';
    eqHigh.frequency.value = 8000;
    eqHigh.gain.value = track.eqHighDb;

    const comp = offline.createDynamicsCompressor();
    comp.threshold.value = track.compThresholdDb;
    comp.ratio.value = track.compRatio;
    comp.attack.value = 0.008;
    comp.release.value = 0.14;
    comp.knee.value = 6;

    const panner = offline.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, track.pan));

    const fader = offline.createGain();
    fader.gain.value = dbToGain(track.volumeDb);

    src.connect(eqLow);
    eqLow.connect(eqMid);
    eqMid.connect(eqHigh);
    eqHigh.connect(comp);
    comp.connect(panner);
    panner.connect(fader);
    fader.connect(mixBus);

    if (track.reverbSend > 0.01) {
      const revSend = offline.createGain();
      revSend.gain.value = track.reverbSend;
      fader.connect(revSend);
      revSend.connect(reverbConvolver);
    }
    if (track.delaySend > 0.01) {
      const delSend = offline.createGain();
      delSend.gain.value = track.delaySend;
      fader.connect(delSend);
      delSend.connect(delayNode);
    }

    const offset = Math.max(0, track.trimStartSec);
    const clipDuration = Math.max(0.01, Math.min(buf.duration - offset, track.trimEndSec - track.trimStartSec));
    src.start(Math.max(0, track.startOffsetSec), offset, clipDuration);
  }

  if (options.includeMasterChain) {
    // Master 4-Band EQ
    const mLow = offline.createBiquadFilter();
    mLow.type = 'lowshelf';
    mLow.frequency.value = 85;
    mLow.gain.value = master.eqLowDb;

    const mMid = offline.createBiquadFilter();
    mMid.type = 'peaking';
    mMid.frequency.value = 950;
    mMid.Q.value = 0.85;
    mMid.gain.value = master.eqMidDb;

    const mHigh = offline.createBiquadFilter();
    mHigh.type = 'peaking';
    mHigh.frequency.value = 4800;
    mHigh.Q.value = 0.9;
    mHigh.gain.value = master.eqHighDb;

    const mAir = offline.createBiquadFilter();
    mAir.type = 'highshelf';
    mAir.frequency.value = 12000;
    mAir.gain.value = master.eqAirDb;

    // Mid-Side Stereo Width Matrix
    const splitter = offline.createChannelSplitter(2);
    const merger = offline.createChannelMerger(2);
    const width = Math.max(0, Math.min(2, master.stereoWidth));

    const lToMid = offline.createGain();
    lToMid.gain.value = 0.5;
    const rToMid = offline.createGain();
    rToMid.gain.value = 0.5;

    const lToSide = offline.createGain();
    lToSide.gain.value = 0.5 * width;
    const rToSide = offline.createGain();
    rToSide.gain.value = -0.5 * width;

    const midNode = offline.createGain();
    const sideNode = offline.createGain();
    const sideNeg = offline.createGain();
    sideNeg.gain.value = -1;

    // Glue Compressor
    const glue = offline.createDynamicsCompressor();
    glue.threshold.value = master.compThresholdDb;
    glue.ratio.value = master.compRatio;
    glue.attack.value = 0.015;
    glue.release.value = 0.18;
    glue.knee.value = 8;

    // Limiter Drive + Brickwall
    const drive = offline.createGain();
    drive.gain.value = dbToGain(master.limiterDriveDb);

    const limiter = offline.createDynamicsCompressor();
    limiter.threshold.value = master.limiterCeilingDb;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.05;
    limiter.knee.value = 0;

    mixBus.connect(mLow);
    mLow.connect(mMid);
    mMid.connect(mHigh);
    mHigh.connect(mAir);
    mAir.connect(splitter);

    splitter.connect(lToMid, 0);
    splitter.connect(rToMid, 1);
    splitter.connect(lToSide, 0);
    splitter.connect(rToSide, 1);

    lToMid.connect(midNode);
    rToMid.connect(midNode);
    lToSide.connect(sideNode);
    rToSide.connect(sideNode);

    midNode.connect(merger, 0, 0);
    sideNode.connect(merger, 0, 0);
    midNode.connect(merger, 0, 1);
    sideNode.connect(sideNeg);
    sideNeg.connect(merger, 0, 1);

    merger.connect(glue);
    glue.connect(drive);
    drive.connect(limiter);
    limiter.connect(offline.destination);
  } else {
    mixBus.connect(offline.destination);
  }

  const rendered = await offline.startRendering();

  // Trim tail silence cleanly to durationSec + 0.3s
  const finalLength = Math.min(rendered.length, Math.ceil((durationSec + 0.3) * sampleRate));
  const trimmed = offline.createBuffer(2, finalLength, sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    trimmed.copyToChannel(rendered.getChannelData(ch).subarray(0, finalLength), ch);
  }

  if (options.normalizeToTargetLufs) {
    const ch0 = trimmed.getChannelData(0);
    const ch1 = trimmed.getChannelData(1);
    let sumSq = 0;
    let peak = 1e-6;
    for (let i = 0; i < ch0.length; i++) {
      const m = 0.5 * (ch0[i] + ch1[i]);
      sumSq += m * m;
      const a0 = Math.abs(ch0[i]);
      const a1 = Math.abs(ch1[i]);
      if (a0 > peak) peak = a0;
      if (a1 > peak) peak = a1;
    }
    const rmsDb = 20 * Math.log10(Math.max(1e-6, Math.sqrt(sumSq / Math.max(1, ch0.length))));
    const currentLufs = rmsDb - 0.7;
    const neededGainDb = master.targetLufs - currentLufs;
    const ceilingLinear = dbToGain(master.limiterCeilingDb);
    const maxSafeGainDb = 20 * Math.log10(ceilingLinear / peak);
    const applyGain = dbToGain(Math.min(neededGainDb, maxSafeGainDb));
    for (let i = 0; i < ch0.length; i++) {
      ch0[i] = Math.max(-ceilingLinear, Math.min(ceilingLinear, ch0[i] * applyGain));
      ch1[i] = Math.max(-ceilingLinear, Math.min(ceilingLinear, ch1[i] * applyGain));
    }
  }

  return trimmed;
}

export async function renderSingleTrackStem(track: StudioTrack, sampleRate: number): Promise<AudioBuffer> {
  const buf =
    track.aiDenoiseEnabled && track.cleanedBuffer
      ? track.cleanedBuffer
      : track.rawBuffer ?? track.cleanedBuffer;
  if (!buf) {
    throw new Error(`Track "${track.name}" has no audio loaded.`);
  }
  const clipDuration = Math.max(0.05, Math.min(buf.duration - track.trimStartSec, track.trimEndSec - track.trimStartSec));
  const length = Math.ceil(clipDuration * sampleRate);
  const offline = new OfflineAudioContext(buf.numberOfChannels, length, sampleRate);
  const src = offline.createBufferSource();
  src.buffer = buf;

  const eqLow = offline.createBiquadFilter();
  eqLow.type = 'lowshelf';
  eqLow.frequency.value = 110;
  eqLow.gain.value = track.eqLowDb;

  const eqMid = offline.createBiquadFilter();
  eqMid.type = 'peaking';
  eqMid.frequency.value = 1200;
  eqMid.gain.value = track.eqMidDb;

  const eqHigh = offline.createBiquadFilter();
  eqHigh.type = 'highshelf';
  eqHigh.frequency.value = 8000;
  eqHigh.gain.value = track.eqHighDb;

  src.connect(eqLow);
  eqLow.connect(eqMid);
  eqMid.connect(eqHigh);
  eqHigh.connect(offline.destination);
  src.start(0, Math.max(0, track.trimStartSec), clipDuration);
  return offline.startRendering();
}

export function encodeToWav(buffer: AudioBuffer, bitDepth: 16 | 24): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = buffer.length * blockAlign;
  const arrayBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(arrayBuffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) {
    channels.push(buffer.getChannelData(c));
  }

  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let c = 0; c < numChannels; c++) {
      const sample = Math.max(-1, Math.min(1, channels[c][i]));
      if (bitDepth === 16) {
        const val = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
        view.setInt16(offset, val, true);
        offset += 2;
      } else {
        const val = sample < 0 ? Math.round(sample * 0x800000) : Math.round(sample * 0x7fffff);
        view.setUint8(offset, val & 0xff);
        view.setUint8(offset + 1, (val >> 8) & 0xff);
        view.setUint8(offset + 2, (val >> 16) & 0xff);
        offset += 3;
      }
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

export function encodeToAiff24(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const numFrames = buffer.length;
  const sampleRate = buffer.sampleRate;
  const bytesPerSample = 3;
  const soundDataSize = numFrames * numChannels * bytesPerSample;
  const totalSize = 54 + soundDataSize;
  const arrayBuffer = new ArrayBuffer(totalSize);
  const view = new DataView(arrayBuffer);

  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  // Write IEEE 754 80-bit extended float for sample rate
  const writeExtended80 = (offset: number, val: number) => {
    let exp = 16383 + 31;
    let mant = Math.round(val);
    while ((mant & 0x80000000) === 0 && exp > 0) {
      mant <<= 1;
      exp--;
    }
    view.setUint16(offset, exp, false);
    view.setUint32(offset + 2, mant >>> 0, false);
    view.setUint32(offset + 6, 0, false);
  };

  writeStr(0, 'FORM');
  view.setUint32(4, totalSize - 8, false);
  writeStr(8, 'AIFF');
  writeStr(12, 'COMM');
  view.setUint32(16, 18, false);
  view.setUint16(20, numChannels, false);
  view.setUint32(22, numFrames, false);
  view.setUint16(26, 24, false);
  writeExtended80(28, sampleRate);
  writeStr(38, 'SSND');
  view.setUint32(42, soundDataSize + 8, false);
  view.setUint32(46, 0, false);
  view.setUint32(50, 0, false);

  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) {
    channels.push(buffer.getChannelData(c));
  }

  let offset = 54;
  for (let i = 0; i < numFrames; i++) {
    for (let c = 0; c < numChannels; c++) {
      const sample = Math.max(-1, Math.min(1, channels[c][i]));
      const val = sample < 0 ? Math.round(sample * 0x800000) : Math.round(sample * 0x7fffff);
      view.setUint8(offset, (val >> 16) & 0xff);
      view.setUint8(offset + 1, (val >> 8) & 0xff);
      view.setUint8(offset + 2, val & 0xff);
      offset += 3;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/aiff' });
}

export function encodeToMp3(buffer: AudioBuffer, kbps: 192 | 320): Blob {
  const numChannels = Math.min(2, buffer.numberOfChannels);
  const sampleRate = buffer.sampleRate;
  const encoder = new Mp3Encoder(numChannels, sampleRate, kbps);

  const floatToInt16 = (arr: Float32Array) => {
    const out = new Int16Array(arr.length);
    for (let i = 0; i < arr.length; i++) {
      const s = Math.max(-1, Math.min(1, arr[i]));
      out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
    }
    return out;
  };

  const left = floatToInt16(buffer.getChannelData(0));
  const right = numChannels > 1 ? floatToInt16(buffer.getChannelData(1)) : left;

  const mp3Parts: BlobPart[] = [];
  const blockSize = 1152;
  for (let i = 0; i < left.length; i += blockSize) {
    const lChunk = left.subarray(i, i + blockSize);
    const rChunk = right.subarray(i, i + blockSize);
    const mp3buf = numChannels === 2 ? encoder.encodeBuffer(lChunk, rChunk) : encoder.encodeBuffer(lChunk);
    if (mp3buf.length > 0) {
      mp3Parts.push(new Uint8Array(mp3buf));
    }
  }
  const endBuf = encoder.flush();
  if (endBuf.length > 0) {
    mp3Parts.push(new Uint8Array(endBuf));
  }

  return new Blob(mp3Parts, { type: 'audio/mpeg' });
}

export async function encodeToWebmOpus(buffer: AudioBuffer): Promise<Blob> {
  const ctx = new AudioContext({ sampleRate: buffer.sampleRate });
  const dest = ctx.createMediaStreamDestination();
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(dest);

  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : 'audio/webm';
  const recorder = new MediaRecorder(dest.stream, {
    mimeType,
    audioBitsPerSecond: 256000,
  });

  const chunks: Blob[] = [];
  return new Promise((resolve, reject) => {
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onerror = () => reject(new Error('WebM Opus encoding failed.'));
    recorder.onstop = () => {
      ctx.close().catch(() => undefined);
      resolve(new Blob(chunks, { type: mimeType }));
    };

    recorder.start();
    src.start();
    src.onended = () => {
      setTimeout(() => {
        if (recorder.state !== 'inactive') recorder.stop();
      }, 120);
    };
  });
}

export async function encodeBufferByFormat(buffer: AudioBuffer, format: ExportFormat): Promise<{
  blob: Blob;
  ext: string;
}> {
  switch (format) {
    case 'wav24':
      return { blob: encodeToWav(buffer, 24), ext: 'wav' };
    case 'wav16':
      return { blob: encodeToWav(buffer, 16), ext: 'wav' };
    case 'aiff24':
      return { blob: encodeToAiff24(buffer), ext: 'aiff' };
    case 'mp3_320':
      return { blob: encodeToMp3(buffer, 320), ext: 'mp3' };
    case 'mp3_192':
      return { blob: encodeToMp3(buffer, 192), ext: 'mp3' };
    case 'webm_opus': {
      const blob = await encodeToWebmOpus(buffer);
      return { blob, ext: 'webm' };
    }
  }
}
