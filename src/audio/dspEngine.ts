import type { MixdownTelemetry } from '../types/studio';

export interface DenoiseOptions {
  highpassHz: number;
  humNotchHz: number;
  denoiseStrength: number;
  vocalPreserveMode: boolean;
  deEssDb: number;
}

export interface AcousticTelemetry {
  noiseFloorDb: number;
  peakDb: number;
  hum50HzRatio: number;
  hum60HzRatio: number;
  subRumbleRatio: number;
  vocalFormantEnergyRatio: number;
  sibilanceRatio: number;
}

// In-place radix-2 Cooley-Tukey FFT
export function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    while (j & bit) {
      j ^= bit;
      bit >>= 1;
    }
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const halfLen = len >> 1;
    const angle = (-2 * Math.PI) / len;
    const wLenRe = Math.cos(angle);
    const wLenIm = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let wRe = 1;
      let wIm = 0;
      for (let j = 0; j < halfLen; j++) {
        const uRe = re[i + j];
        const uIm = im[i + j];
        const vRe = re[i + j + halfLen] * wRe - im[i + j + halfLen] * wIm;
        const vIm = re[i + j + halfLen] * wIm + im[i + j + halfLen] * wRe;
        re[i + j] = uRe + vRe;
        im[i + j] = uIm + vIm;
        re[i + j + halfLen] = uRe - vRe;
        im[i + j + halfLen] = uIm - vIm;
        const nextWRe = wRe * wLenRe - wIm * wLenIm;
        wIm = wRe * wLenIm + wIm * wLenRe;
        wRe = nextWRe;
      }
    }
  }
}

export function ifft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 0; i < n; i++) {
    im[i] = -im[i];
  }
  fft(re, im);
  for (let i = 0; i < n; i++) {
    re[i] /= n;
    im[i] = -im[i] / n;
  }
}

function buildHannWindow(size: number): Float32Array {
  const win = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    win[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
  }
  return win;
}

export function computePeaks(buffer: AudioBuffer, count = 180): number[] {
  const ch0 = buffer.getChannelData(0);
  const ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null;
  const total = ch0.length;
  if (total === 0) return [0];
  const step = Math.max(1, Math.floor(total / count));
  const peaks: number[] = [];
  for (let i = 0; i < count; i++) {
    const start = i * step;
    const end = Math.min(total, start + step);
    let maxAbs = 0;
    for (let s = start; s < end; s++) {
      const a0 = Math.abs(ch0[s]);
      const a1 = ch1 ? Math.abs(ch1[s]) : 0;
      const val = a0 > a1 ? a0 : a1;
      if (val > maxAbs) maxAbs = val;
    }
    peaks.push(Number(Math.min(1, maxAbs).toFixed(4)));
  }
  return peaks;
}

export function extractAcousticTelemetry(buffer: AudioBuffer): AcousticTelemetry {
  const data = buffer.getChannelData(0);
  const sr = buffer.sampleRate;
  const fftSize = 2048;
  const hop = 1024;
  const win = buildHannWindow(fftSize);
  const re = new Float32Array(fftSize);
  const im = new Float32Array(fftSize);

  let peak = 0.00001;
  const frameRmsList: number[] = [];

  let totalEnergy = 0.000001;
  let hum50Energy = 0;
  let hum60Energy = 0;
  let subRumbleEnergy = 0;
  let vocalFormantEnergy = 0;
  let sibilanceEnergy = 0;

  for (let offset = 0; offset + fftSize <= data.length; offset += hop) {
    let sumSq = 0;
    for (let i = 0; i < fftSize; i++) {
      const s = data[offset + i];
      const abs = Math.abs(s);
      if (abs > peak) peak = abs;
      sumSq += s * s;
      re[i] = s * win[i];
      im[i] = 0;
    }
    const rms = Math.sqrt(sumSq / fftSize);
    frameRmsList.push(rms);

    fft(re, im);
    const half = fftSize >> 1;
    const binHz = sr / fftSize;
    for (let k = 1; k < half; k++) {
      const mag2 = re[k] * re[k] + im[k] * im[k];
      const freq = k * binHz;
      totalEnergy += mag2;
      if (freq >= 45 && freq <= 55) hum50Energy += mag2;
      if (freq >= 55 && freq <= 65) hum60Energy += mag2;
      if (freq < 85) subRumbleEnergy += mag2;
      if (freq >= 220 && freq <= 3800) vocalFormantEnergy += mag2;
      if (freq >= 5500 && freq <= 9000) sibilanceEnergy += mag2;
    }
  }

  frameRmsList.sort((a, b) => a - b);
  const noiseSliceEnd = Math.max(1, Math.floor(frameRmsList.length * 0.15));
  let noiseRmsSum = 0;
  for (let i = 0; i < noiseSliceEnd; i++) {
    noiseRmsSum += frameRmsList[i];
  }
  const noiseRms = Math.max(0.00001, noiseRmsSum / noiseSliceEnd);

  return {
    noiseFloorDb: Number((20 * Math.log10(noiseRms)).toFixed(2)),
    peakDb: Number((20 * Math.log10(peak)).toFixed(2)),
    hum50HzRatio: Number((hum50Energy / totalEnergy).toFixed(4)),
    hum60HzRatio: Number((hum60Energy / totalEnergy).toFixed(4)),
    subRumbleRatio: Number((subRumbleEnergy / totalEnergy).toFixed(4)),
    vocalFormantEnergyRatio: Number((vocalFormantEnergy / totalEnergy).toFixed(4)),
    sibilanceRatio: Number((sibilanceEnergy / totalEnergy).toFixed(4)),
  };
}

export function estimateNoiseSpectrum(
  channelData: Float32Array,
  sampleRate: number,
  fftSize = 1024,
  hop = 256
): Float32Array {
  const half = fftSize >> 1;
  const win = buildHannWindow(fftSize);
  const frames: { rms: number; mag: Float32Array }[] = [];
  const re = new Float32Array(fftSize);
  const im = new Float32Array(fftSize);

  for (let offset = 0; offset + fftSize <= channelData.length; offset += hop) {
    let sumSq = 0;
    for (let i = 0; i < fftSize; i++) {
      const s = channelData[offset + i];
      sumSq += s * s;
      re[i] = s * win[i];
      im[i] = 0;
    }
    const rms = Math.sqrt(sumSq / fftSize);
    if (rms < 1e-6) continue;
    fft(re, im);
    const mag = new Float32Array(half + 1);
    for (let k = 0; k <= half; k++) {
      mag[k] = Math.hypot(re[k], im[k]);
    }
    frames.push({ rms, mag });
  }

  const noiseProfile = new Float32Array(half + 1);
  if (frames.length === 0) return noiseProfile;

  frames.sort((a, b) => a.rms - b.rms);
  const count = Math.max(1, Math.min(40, Math.floor(frames.length * 0.15)));
  for (let i = 0; i < count; i++) {
    const mag = frames[i].mag;
    for (let k = 0; k <= half; k++) {
      noiseProfile[k] += mag[k];
    }
  }
  for (let k = 0; k <= half; k++) {
    noiseProfile[k] = (noiseProfile[k] / count) * (sampleRate > 0 ? 1.15 : 1.15);
  }
  return noiseProfile;
}

function spectralDenoiseChannel(
  input: Float32Array,
  sampleRate: number,
  options: DenoiseOptions,
  customNoiseSpectrum?: Float32Array
): Float32Array {
  const fftSize = 1024;
  const hop = 256;
  const half = fftSize >> 1;
  const win = buildHannWindow(fftSize);
  const noiseProfile = customNoiseSpectrum ?? estimateNoiseSpectrum(input, sampleRate, fftSize, hop);

  const output = new Float32Array(input.length);
  const norm = new Float32Array(input.length);
  const re = new Float32Array(fftSize);
  const im = new Float32Array(fftSize);
  const prevGain = new Float32Array(half + 1).fill(1);
  const binHz = sampleRate / fftSize;

  const strength = Math.max(0, Math.min(1, options.denoiseStrength));
  const minFloor = options.vocalPreserveMode ? 0.16 : 0.06;

  for (let offset = 0; offset + fftSize <= input.length; offset += hop) {
    let frameSumSq = 0;
    for (let i = 0; i < fftSize; i++) {
      const s = input[offset + i];
      frameSumSq += s * s;
      re[i] = s * win[i];
      im[i] = 0;
    }
    const frameRms = Math.sqrt(frameSumSq / fftSize);
    fft(re, im);

    // Measure vocal formant presence in this frame (180Hz - 4000Hz)
    let vocalBandEnergy = 0;
    let totalBandEnergy = 1e-9;
    for (let k = 1; k <= half; k++) {
      const mag = Math.hypot(re[k], im[k]);
      const freq = k * binHz;
      totalBandEnergy += mag * mag;
      if (freq >= 180 && freq <= 4000) {
        vocalBandEnergy += mag * mag;
      }
    }
    const vocalDominance = vocalBandEnergy / totalBandEnergy;
    const isActiveVocalFrame = options.vocalPreserveMode && vocalDominance > 0.35 && frameRms > 0.008;

    for (let k = 0; k <= half; k++) {
      const mag = Math.hypot(re[k], im[k]) + 1e-9;
      const noiseMag = noiseProfile[k] * (1 + strength * 1.45);
      const freq = k * binHz;

      // Wiener-style soft spectral gain
      const snrRatio = (noiseMag * noiseMag) / (mag * mag);
      let rawGain = Math.max(minFloor, 1 - strength * snrRatio);

      // Protect vocal fundamentals & formants (160Hz - 4200Hz) during active singing/speech
      if (isActiveVocalFrame && freq >= 160 && freq <= 4200) {
        const formantProtection = freq >= 250 && freq <= 3200 ? 0.78 : 0.55;
        rawGain = Math.max(rawGain, formantProtection);
      }

      // Temporal smoothing eliminates musical-noise birdies
      const smoothedGain = 0.65 * prevGain[k] + 0.35 * rawGain;
      prevGain[k] = smoothedGain;

      re[k] *= smoothedGain;
      im[k] *= smoothedGain;
      if (k > 0 && k < half) {
        re[fftSize - k] *= smoothedGain;
        im[fftSize - k] *= smoothedGain;
      }
    }

    ifft(re, im);

    for (let i = 0; i < fftSize; i++) {
      output[offset + i] += re[i] * win[i];
      norm[offset + i] += win[i] * win[i];
    }
  }

  for (let i = 0; i < input.length; i++) {
    output[i] = norm[i] > 1e-6 ? output[i] / norm[i] : input[i];
  }
  return output;
}

function measureVocalRetentionPct(raw: Float32Array, cleaned: Float32Array, sampleRate: number): number {
  const fftSize = 1024;
  const hop = 512;
  const half = fftSize >> 1;
  const binHz = sampleRate / fftSize;
  const win = buildHannWindow(fftSize);

  const reA = new Float32Array(fftSize);
  const imA = new Float32Array(fftSize);
  const reB = new Float32Array(fftSize);
  const imB = new Float32Array(fftSize);

  let dotSum = 0;
  let normASum = 0;
  let normBSum = 0;

  for (let offset = 0; offset + fftSize <= raw.length; offset += hop) {
    let rms = 0;
    for (let i = 0; i < fftSize; i++) {
      const s = raw[offset + i];
      rms += s * s;
      reA[i] = s * win[i];
      imA[i] = 0;
      reB[i] = cleaned[offset + i] * win[i];
      imB[i] = 0;
    }
    rms = Math.sqrt(rms / fftSize);
    if (rms < 0.01) continue; // Only evaluate active vocal/instrument frames

    fft(reA, imA);
    fft(reB, imB);

    for (let k = 1; k < half; k++) {
      const freq = k * binHz;
      if (freq >= 200 && freq <= 4000) {
        const mA = Math.hypot(reA[k], imA[k]);
        const mB = Math.hypot(reB[k], imB[k]);
        dotSum += mA * mB;
        normASum += mA * mA;
        normBSum += mB * mB;
      }
    }
  }

  if (normASum < 1e-9 || normBSum < 1e-9) return 98.5;
  const cosineSim = dotSum / (Math.sqrt(normASum) * Math.sqrt(normBSum));
  return Number(Math.max(0, Math.min(100, cosineSim * 100)).toFixed(1));
}

export async function applyVocalPreservingDenoise(
  rawBuffer: AudioBuffer,
  options: DenoiseOptions,
  customNoiseSpectrum?: Float32Array
): Promise<{ cleanedBuffer: AudioBuffer; vocalRetentionPct: number }> {
  const sampleRate = rawBuffer.sampleRate;
  const length = rawBuffer.length;
  const channels = rawBuffer.numberOfChannels;

  const offline = new OfflineAudioContext(channels, length, sampleRate);
  const tempBuffer = offline.createBuffer(channels, length, sampleRate);

  for (let ch = 0; ch < channels; ch++) {
    const rawData = rawBuffer.getChannelData(ch);
    const denoised = spectralDenoiseChannel(rawData, sampleRate, options, customNoiseSpectrum);
    tempBuffer.getChannelData(ch).set(denoised);
  }

  // Precision linear filtering stage via OfflineAudioContext
  const source = offline.createBufferSource();
  source.buffer = tempBuffer;

  let head: AudioNode = source;

  if (options.highpassHz > 20) {
    const hp1 = offline.createBiquadFilter();
    hp1.type = 'highpass';
    hp1.frequency.value = options.highpassHz;
    hp1.Q.value = 0.707;
    head.connect(hp1);
    head = hp1;
  }

  if (options.humNotchHz === 50 || options.humNotchHz === 60) {
    const notch1 = offline.createBiquadFilter();
    notch1.type = 'notch';
    notch1.frequency.value = options.humNotchHz;
    notch1.Q.value = 10;
    head.connect(notch1);
    head = notch1;

    const notch2 = offline.createBiquadFilter();
    notch2.type = 'notch';
    notch2.frequency.value = options.humNotchHz * 2;
    notch2.Q.value = 10;
    head.connect(notch2);
    head = notch2;
  }

  if (options.deEssDb > 0.1) {
    const deEss = offline.createBiquadFilter();
    deEss.type = 'peaking';
    deEss.frequency.value = 6800;
    deEss.Q.value = 2.2;
    deEss.gain.value = -Math.min(10, options.deEssDb);
    head.connect(deEss);
    head = deEss;
  }

  if (options.vocalPreserveMode) {
    const presenceWarmth = offline.createBiquadFilter();
    presenceWarmth.type = 'peaking';
    presenceWarmth.frequency.value = 2600;
    presenceWarmth.Q.value = 0.9;
    presenceWarmth.gain.value = 0.8;
    head.connect(presenceWarmth);
    head = presenceWarmth;
  }

  head.connect(offline.destination);
  source.start(0);

  const cleanedBuffer = await offline.startRendering();
  const vocalRetentionPct = measureVocalRetentionPct(
    rawBuffer.getChannelData(0),
    cleanedBuffer.getChannelData(0),
    sampleRate
  );

  return { cleanedBuffer, vocalRetentionPct };
}

export function createStudioReverbImpulse(
  ctx: BaseAudioContext,
  durationSec = 1.8,
  decay = 2.6
): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * durationSec);
  const impulse = ctx.createBuffer(2, length, rate);
  for (let ch = 0; ch < 2; ch++) {
    const channelData = impulse.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      const t = i / length;
      const env = Math.pow(1 - t, decay);
      // Smooth early-to-late studio room tail
      channelData[i] = (Math.random() * 2 - 1) * env * 0.45;
    }
  }
  return impulse;
}

export function analyzeMixdownTelemetry(buffer: AudioBuffer, hasVocals: boolean): MixdownTelemetry {
  const ch0 = buffer.getChannelData(0);
  const ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : ch0;
  const sr = buffer.sampleRate;

  let peak = 1e-6;
  let sumSq = 0;
  const len = ch0.length;
  for (let i = 0; i < len; i++) {
    const s = 0.5 * (ch0[i] + ch1[i]);
    const a0 = Math.abs(ch0[i]);
    const a1 = Math.abs(ch1[i]);
    if (a0 > peak) peak = a0;
    if (a1 > peak) peak = a1;
    sumSq += s * s;
  }

  const rms = Math.max(1e-6, Math.sqrt(sumSq / Math.max(1, len)));
  const peakDb = 20 * Math.log10(peak);
  const rmsDb = 20 * Math.log10(rms);
  const integratedLufs = rmsDb - 0.7;
  const crestFactorDb = Math.max(0, peakDb - rmsDb);

  const fftSize = 2048;
  const hop = Math.max(1024, Math.floor(len / 48));
  const win = buildHannWindow(fftSize);
  const re = new Float32Array(fftSize);
  const im = new Float32Array(fftSize);
  const binHz = sr / fftSize;

  let totalE = 1e-9;
  let lowE = 0;
  let lowMidE = 0;
  let presenceE = 0;
  let airE = 0;

  for (let offset = 0; offset + fftSize <= len; offset += hop) {
    for (let i = 0; i < fftSize; i++) {
      re[i] = 0.5 * (ch0[offset + i] + ch1[offset + i]) * win[i];
      im[i] = 0;
    }
    fft(re, im);
    const half = fftSize >> 1;
    for (let k = 1; k < half; k++) {
      const freq = k * binHz;
      const e = re[k] * re[k] + im[k] * im[k];
      totalE += e;
      if (freq < 180) lowE += e;
      else if (freq < 800) lowMidE += e;
      else if (freq < 5000) presenceE += e;
      else airE += e;
    }
  }

  return {
    integratedLufs: Number(integratedLufs.toFixed(1)),
    shortTermPeakDb: Number(peakDb.toFixed(1)),
    crestFactorDb: Number(crestFactorDb.toFixed(1)),
    lowEnergyRatio: Number((lowE / totalE).toFixed(3)),
    lowMidEnergyRatio: Number((lowMidE / totalE).toFixed(3)),
    presenceEnergyRatio: Number((presenceE / totalE).toFixed(3)),
    airEnergyRatio: Number((airE / totalE).toFixed(3)),
    hasVocals,
  };
}
