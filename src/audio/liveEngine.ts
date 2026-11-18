import type { MasterSettings, StudioTrack } from '../types/studio';
import { createStudioReverbImpulse } from './dspEngine';
import { dbToGain } from './exportEngine';

export interface LiveMeterData {
  peakL: number;
  peakR: number;
  rmsDb: number;
  shortTermLufs: number;
  fftBins: Uint8Array;
}

interface TrackNodeGraph {
  trackId: string;
  source: AudioBufferSourceNode;
  eqLow: BiquadFilterNode;
  eqMid: BiquadFilterNode;
  eqHigh: BiquadFilterNode;
  comp: DynamicsCompressorNode;
  panner: StereoPannerNode;
  fader: GainNode;
  revSend: GainNode;
  delSend: GainNode;
}

class StudioAudioEngine {
  private ctx: AudioContext | null = null;
  private mixBus: GainNode | null = null;
  private reverbConvolver: ConvolverNode | null = null;
  private delayNode: DelayNode | null = null;

  // Master nodes
  private mLow: BiquadFilterNode | null = null;
  private mMid: BiquadFilterNode | null = null;
  private mHigh: BiquadFilterNode | null = null;
  private mAir: BiquadFilterNode | null = null;
  private mSideL: GainNode | null = null;
  private mSideR: GainNode | null = null;
  private mGlue: DynamicsCompressorNode | null = null;
  private mDrive: GainNode | null = null;
  private mLimiter: DynamicsCompressorNode | null = null;
  private mBypass: boolean = false;

  // Analyzers
  private analyserL: AnalyserNode | null = null;
  private analyserR: AnalyserNode | null = null;
  private analyserFFT: AnalyserNode | null = null;
  private fftData = new Uint8Array(1024);
  private timeDataL = new Float32Array(1024);
  private timeDataR = new Float32Array(1024);

  private activeGraphs = new Map<string, TrackNodeGraph>();
  private startCtxTime = 0;
  private startProjectOffset = 0;
  private playing = false;
  private metronomeTimer: number | null = null;
  private nextClickTime = 0;
  private clickBeatIndex = 0;

  // Mic Recording state
  private micStream: MediaStream | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private micGainNode: GainNode | null = null;
  private micAnalyser: AnalyserNode | null = null;
  private micMonitorGain: GainNode | null = null;
  private micProcessor: ScriptProcessorNode | null = null;
  private recordedChunks: Float32Array[] = [];
  private isRecording = false;
  private recordingSampleRate = 48000;

  public getContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
      this.setupMasterGraph(this.ctx);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => undefined);
    }
    return this.ctx;
  }

  private setupMasterGraph(ctx: AudioContext): void {
    this.mixBus = ctx.createGain();
    this.mixBus.gain.value = 1;

    this.reverbConvolver = ctx.createConvolver();
    this.reverbConvolver.buffer = createStudioReverbImpulse(ctx, 1.8, 2.5);
    const revReturn = ctx.createGain();
    revReturn.gain.value = 0.85;
    this.reverbConvolver.connect(revReturn);
    revReturn.connect(this.mixBus);

    this.delayNode = ctx.createDelay(2.0);
    this.delayNode.delayTime.value = 0.25;
    const delFeedback = ctx.createGain();
    delFeedback.gain.value = 0.28;
    const delTone = ctx.createBiquadFilter();
    delTone.type = 'lowpass';
    delTone.frequency.value = 4200;
    const delReturn = ctx.createGain();
    delReturn.gain.value = 0.65;

    this.delayNode.connect(delTone);
    delTone.connect(delFeedback);
    delFeedback.connect(this.delayNode);
    delTone.connect(delReturn);
    delReturn.connect(this.mixBus);

    this.mLow = ctx.createBiquadFilter();
    this.mLow.type = 'lowshelf';
    this.mLow.frequency.value = 85;

    this.mMid = ctx.createBiquadFilter();
    this.mMid.type = 'peaking';
    this.mMid.frequency.value = 950;
    this.mMid.Q.value = 0.85;

    this.mHigh = ctx.createBiquadFilter();
    this.mHigh.type = 'peaking';
    this.mHigh.frequency.value = 4800;
    this.mHigh.Q.value = 0.9;

    this.mAir = ctx.createBiquadFilter();
    this.mAir.type = 'highshelf';
    this.mAir.frequency.value = 12000;

    const msSplitter = ctx.createChannelSplitter(2);
    const msMerger = ctx.createChannelMerger(2);
    const lToMid = ctx.createGain();
    lToMid.gain.value = 0.5;
    const rToMid = ctx.createGain();
    rToMid.gain.value = 0.5;
    this.mSideL = ctx.createGain();
    this.mSideL.gain.value = 0.5;
    this.mSideR = ctx.createGain();
    this.mSideR.gain.value = -0.5;
    const midNode = ctx.createGain();
    const sideNode = ctx.createGain();
    const sideNeg = ctx.createGain();
    sideNeg.gain.value = -1;

    this.mGlue = ctx.createDynamicsCompressor();
    this.mGlue.attack.value = 0.015;
    this.mGlue.release.value = 0.18;
    this.mGlue.knee.value = 8;

    this.mDrive = ctx.createGain();
    this.mDrive.gain.value = 1;

    this.mLimiter = ctx.createDynamicsCompressor();
    this.mLimiter.ratio.value = 20;
    this.mLimiter.attack.value = 0.001;
    this.mLimiter.release.value = 0.05;
    this.mLimiter.knee.value = 0;

    // Meters
    const outSplitter = ctx.createChannelSplitter(2);
    this.analyserL = ctx.createAnalyser();
    this.analyserL.fftSize = 1024;
    this.analyserR = ctx.createAnalyser();
    this.analyserR.fftSize = 1024;
    this.analyserFFT = ctx.createAnalyser();
    this.analyserFFT.fftSize = 2048;
    this.analyserFFT.smoothingTimeConstant = 0.78;
    this.fftData = new Uint8Array(this.analyserFFT.frequencyBinCount);

    this.mixBus.connect(this.mLow);
    this.mLow.connect(this.mMid);
    this.mMid.connect(this.mHigh);
    this.mHigh.connect(this.mAir);
    this.mAir.connect(msSplitter);

    msSplitter.connect(lToMid, 0);
    msSplitter.connect(rToMid, 1);
    msSplitter.connect(this.mSideL, 0);
    msSplitter.connect(this.mSideR, 1);

    lToMid.connect(midNode);
    rToMid.connect(midNode);
    this.mSideL.connect(sideNode);
    this.mSideR.connect(sideNode);

    midNode.connect(msMerger, 0, 0);
    sideNode.connect(msMerger, 0, 0);
    midNode.connect(msMerger, 0, 1);
    sideNode.connect(sideNeg);
    sideNeg.connect(msMerger, 0, 1);

    msMerger.connect(this.mGlue);
    this.mGlue.connect(this.mDrive);
    this.mDrive.connect(this.mLimiter);

    this.mLimiter.connect(this.analyserFFT);
    this.mLimiter.connect(outSplitter);
    outSplitter.connect(this.analyserL, 0);
    outSplitter.connect(this.analyserR, 1);
    this.mLimiter.connect(ctx.destination);
  }

  public updateMasterSettings(master: MasterSettings, bypass: boolean, bpm: number): void {
    this.mBypass = bypass;
    const ctx = this.ctx;
    if (!ctx || !this.mLow || !this.mMid || !this.mHigh || !this.mAir || !this.mSideL || !this.mSideR || !this.mGlue || !this.mDrive || !this.mLimiter) {
      return;
    }
    const now = ctx.currentTime;
    if (this.delayNode) {
      this.delayNode.delayTime.setTargetAtTime(Math.min(1.5, 60 / Math.max(40, bpm) / 2), now, 0.02);
    }
    if (bypass) {
      this.mLow.gain.setTargetAtTime(0, now, 0.02);
      this.mMid.gain.setTargetAtTime(0, now, 0.02);
      this.mHigh.gain.setTargetAtTime(0, now, 0.02);
      this.mAir.gain.setTargetAtTime(0, now, 0.02);
      this.mSideL.gain.setTargetAtTime(0.5, now, 0.02);
      this.mSideR.gain.setTargetAtTime(-0.5, now, 0.02);
      this.mGlue.threshold.setTargetAtTime(0, now, 0.02);
      this.mGlue.ratio.setTargetAtTime(1, now, 0.02);
      this.mDrive.gain.setTargetAtTime(1, now, 0.02);
      this.mLimiter.threshold.setTargetAtTime(-0.1, now, 0.02);
      return;
    }

    this.mLow.gain.setTargetAtTime(master.eqLowDb, now, 0.02);
    this.mMid.gain.setTargetAtTime(master.eqMidDb, now, 0.02);
    this.mHigh.gain.setTargetAtTime(master.eqHighDb, now, 0.02);
    this.mAir.gain.setTargetAtTime(master.eqAirDb, now, 0.02);
    const w = Math.max(0, Math.min(2, master.stereoWidth));
    this.mSideL.gain.setTargetAtTime(0.5 * w, now, 0.02);
    this.mSideR.gain.setTargetAtTime(-0.5 * w, now, 0.02);
    this.mGlue.threshold.setTargetAtTime(master.compThresholdDb, now, 0.02);
    this.mGlue.ratio.setTargetAtTime(master.compRatio, now, 0.02);
    this.mDrive.gain.setTargetAtTime(dbToGain(master.limiterDriveDb), now, 0.02);
    this.mLimiter.threshold.setTargetAtTime(master.limiterCeilingDb, now, 0.02);
  }

  public updateLiveTracks(tracks: StudioTrack[]): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const anySolo = tracks.some((t) => t.solo);

    for (const track of tracks) {
      const g = this.activeGraphs.get(track.id);
      if (!g) continue;
      const audible = anySolo ? track.solo : !track.muted;
      g.fader.gain.setTargetAtTime(audible ? dbToGain(track.volumeDb) : 0, now, 0.015);
      g.panner.pan.setTargetAtTime(Math.max(-1, Math.min(1, track.pan)), now, 0.015);
      g.eqLow.gain.setTargetAtTime(track.eqLowDb, now, 0.02);
      g.eqMid.gain.setTargetAtTime(track.eqMidDb, now, 0.02);
      g.eqHigh.gain.setTargetAtTime(track.eqHighDb, now, 0.02);
      g.comp.threshold.setTargetAtTime(track.compThresholdDb, now, 0.02);
      g.comp.ratio.setTargetAtTime(track.compRatio, now, 0.02);
      g.revSend.gain.setTargetAtTime(track.reverbSend, now, 0.02);
      g.delSend.gain.setTargetAtTime(track.delaySend, now, 0.02);
    }
  }

  public startPlayback(
    tracks: StudioTrack[],
    master: MasterSettings,
    fromOffsetSec: number,
    options: { bpm: number; timeSignature: string; metronomeEnabled: boolean; bypassMaster: boolean }
  ): void {
    this.stopPlayback();
    const ctx = this.getContext();
    this.updateMasterSettings(master, options.bypassMaster, options.bpm);

    if (!this.mixBus || !this.reverbConvolver || !this.delayNode) return;

    const anySolo = tracks.some((t) => t.solo);
    const now = ctx.currentTime + 0.03;
    this.startCtxTime = now;
    this.startProjectOffset = Math.max(0, fromOffsetSec);
    this.playing = true;

    for (const track of tracks) {
      const buf =
        track.aiDenoiseEnabled && track.cleanedBuffer
          ? track.cleanedBuffer
          : track.rawBuffer ?? track.cleanedBuffer;
      if (!buf) continue;

      const clipEnd = track.startOffsetSec + Math.max(0, track.trimEndSec - track.trimStartSec);
      if (clipEnd <= fromOffsetSec) continue;

      const src = ctx.createBufferSource();
      src.buffer = buf;

      const eqLow = ctx.createBiquadFilter();
      eqLow.type = 'lowshelf';
      eqLow.frequency.value = 110;
      eqLow.gain.value = track.eqLowDb;

      const eqMid = ctx.createBiquadFilter();
      eqMid.type = 'peaking';
      eqMid.frequency.value = 1200;
      eqMid.Q.value = 1.0;
      eqMid.gain.value = track.eqMidDb;

      const eqHigh = ctx.createBiquadFilter();
      eqHigh.type = 'highshelf';
      eqHigh.frequency.value = 8000;
      eqHigh.gain.value = track.eqHighDb;

      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = track.compThresholdDb;
      comp.ratio.value = track.compRatio;
      comp.attack.value = 0.008;
      comp.release.value = 0.14;

      const panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, track.pan));

      const fader = ctx.createGain();
      const audible = anySolo ? track.solo : !track.muted;
      fader.gain.value = audible ? dbToGain(track.volumeDb) : 0;

      const revSend = ctx.createGain();
      revSend.gain.value = track.reverbSend;
      const delSend = ctx.createGain();
      delSend.gain.value = track.delaySend;

      src.connect(eqLow);
      eqLow.connect(eqMid);
      eqMid.connect(eqHigh);
      eqHigh.connect(comp);
      comp.connect(panner);
      panner.connect(fader);
      fader.connect(this.mixBus);
      fader.connect(revSend);
      revSend.connect(this.reverbConvolver);
      fader.connect(delSend);
      delSend.connect(this.delayNode);

      const relativeToClipStart = fromOffsetSec - track.startOffsetSec;
      if (relativeToClipStart >= 0) {
        const bufOffset = track.trimStartSec + relativeToClipStart;
        const remaining = Math.max(0.01, track.trimEndSec - bufOffset);
        src.start(now, bufOffset, remaining);
      } else {
        const delayStart = -relativeToClipStart;
        const duration = Math.max(0.01, track.trimEndSec - track.trimStartSec);
        src.start(now + delayStart, track.trimStartSec, duration);
      }

      this.activeGraphs.set(track.id, {
        trackId: track.id,
        source: src,
        eqLow,
        eqMid,
        eqHigh,
        comp,
        panner,
        fader,
        revSend,
        delSend,
      });
    }

    if (options.metronomeEnabled) {
      this.startMetronome(ctx, options.bpm, options.timeSignature, now);
    }
  }

  private startMetronome(ctx: AudioContext, bpm: number, timeSignature: string, startAt: number): void {
    const beatsPerBar = Math.max(2, parseInt(timeSignature.split('/')[0] || '4', 10));
    const secPerBeat = 60 / Math.max(40, bpm);
    this.nextClickTime = startAt;
    this.clickBeatIndex = 0;

    const scheduleClick = (time: number, accent: boolean) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = accent ? 1320 : 880;
      gain.gain.setValueAtTime(accent ? 0.16 : 0.09, time);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.045);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(time);
      osc.stop(time + 0.05);
    };

    this.metronomeTimer = window.setInterval(() => {
      if (!this.playing || !this.ctx) return;
      while (this.nextClickTime < this.ctx.currentTime + 0.15) {
        scheduleClick(this.nextClickTime, this.clickBeatIndex % beatsPerBar === 0);
        this.nextClickTime += secPerBeat;
        this.clickBeatIndex++;
      }
    }, 30);
  }

  public stopPlayback(): void {
    this.playing = false;
    if (this.metronomeTimer !== null) {
      clearInterval(this.metronomeTimer);
      this.metronomeTimer = null;
    }
    for (const g of this.activeGraphs.values()) {
      try {
        g.source.stop();
        g.source.disconnect();
      } catch {
        // Ignore already stopped sources
      }
    }
    this.activeGraphs.clear();
  }

  public getCurrentPlayheadSec(): number {
    if (!this.playing || !this.ctx) return this.startProjectOffset;
    return Math.max(0, this.startProjectOffset + (this.ctx.currentTime - this.startCtxTime));
  }

  public getLiveMeters(): LiveMeterData {
    if (!this.analyserL || !this.analyserR || !this.analyserFFT || !this.playing) {
      return {
        peakL: 0,
        peakR: 0,
        rmsDb: -60,
        shortTermLufs: -60,
        fftBins: new Uint8Array(64),
      };
    }

    this.analyserL.getFloatTimeDomainData(this.timeDataL);
    this.analyserR.getFloatTimeDomainData(this.timeDataR);
    this.analyserFFT.getByteFrequencyData(this.fftData);

    let peakL = 0;
    let peakR = 0;
    let sumSq = 0;
    for (let i = 0; i < this.timeDataL.length; i++) {
      const aL = Math.abs(this.timeDataL[i]);
      const aR = Math.abs(this.timeDataR[i]);
      if (aL > peakL) peakL = aL;
      if (aR > peakR) peakR = aR;
      const m = 0.5 * (this.timeDataL[i] + this.timeDataR[i]);
      sumSq += m * m;
    }

    const rms = Math.max(1e-4, Math.sqrt(sumSq / this.timeDataL.length));
    const rmsDb = Math.max(-60, 20 * Math.log10(rms));

    return {
      peakL: Math.min(1, peakL),
      peakR: Math.min(1, peakR),
      rmsDb,
      shortTermLufs: rmsDb - 0.7,
      fftBins: this.fftData,
    };
  }

  // --- Raw Microphone Capture (Preserving Real Voice) ---
  public async listInputDevices(): Promise<MediaDeviceInfo[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === 'audioinput');
  }

  public async armMicrophone(deviceId?: string, monitor = false, inputGain = 1.0): Promise<void> {
    this.disarmMicrophone();
    const ctx = this.getContext();
    const constraints: MediaStreamConstraints = {
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        // Disable browser voice-call processing so we capture raw, uncolored vocals & instruments
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
    };
    this.micStream = await navigator.mediaDevices.getUserMedia(constraints);
    this.recordingSampleRate = ctx.sampleRate;
    this.micSource = ctx.createMediaStreamSource(this.micStream);
    this.micGainNode = ctx.createGain();
    this.micGainNode.gain.value = inputGain;
    this.micAnalyser = ctx.createAnalyser();
    this.micAnalyser.fftSize = 1024;
    this.micMonitorGain = ctx.createGain();
    this.micMonitorGain.gain.value = monitor ? 0.85 : 0;

    // ScriptProcessor captures raw Float32 PCM frames cleanly without lossy codec coloration
    this.micProcessor = ctx.createScriptProcessor(2048, 1, 1);
    this.micProcessor.onaudioprocess = (e) => {
      if (!this.isRecording) return;
      const input = e.inputBuffer.getChannelData(0);
      this.recordedChunks.push(new Float32Array(input));
    };

    this.micSource.connect(this.micGainNode);
    this.micGainNode.connect(this.micAnalyser);
    this.micGainNode.connect(this.micProcessor);
    this.micProcessor.connect(this.micMonitorGain);
    this.micMonitorGain.connect(ctx.destination);
  }

  public setMicInputGain(gain: number): void {
    if (this.micGainNode && this.ctx) {
      this.micGainNode.gain.setTargetAtTime(gain, this.ctx.currentTime, 0.02);
    }
  }

  public setMicMonitor(monitor: boolean): void {
    if (this.micMonitorGain && this.ctx) {
      this.micMonitorGain.gain.setTargetAtTime(monitor ? 0.85 : 0, this.ctx.currentTime, 0.02);
    }
  }

  public getMicInputLevel(): { peakDb: number; normalized: number } {
    if (!this.micAnalyser) return { peakDb: -60, normalized: 0 };
    const buf = new Float32Array(this.micAnalyser.fftSize);
    this.micAnalyser.getFloatTimeDomainData(buf);
    let peak = 1e-4;
    for (let i = 0; i < buf.length; i++) {
      const a = Math.abs(buf[i]);
      if (a > peak) peak = a;
    }
    const peakDb = Math.max(-60, 20 * Math.log10(peak));
    return { peakDb, normalized: Math.min(1, peak) };
  }

  public beginMicCapture(): void {
    this.recordedChunks = [];
    this.isRecording = true;
  }

  public getLiveRecordingPeaks(maxBars = 80): number[] {
    if (this.recordedChunks.length === 0) return [];
    const slice = this.recordedChunks.slice(-maxBars);
    return slice.map((chunk) => {
      let max = 0;
      for (let i = 0; i < chunk.length; i += 8) {
        const a = Math.abs(chunk[i]);
        if (a > max) max = a;
      }
      return Math.min(1, max);
    });
  }

  public endMicCapture(): AudioBuffer | null {
    this.isRecording = false;
    if (this.recordedChunks.length === 0) return null;
    const totalLen = this.recordedChunks.reduce((acc, c) => acc + c.length, 0);
    if (totalLen === 0) return null;

    const ctx = this.getContext();
    const audioBuffer = ctx.createBuffer(1, totalLen, this.recordingSampleRate);
    const out = audioBuffer.getChannelData(0);
    let offset = 0;
    for (const chunk of this.recordedChunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    this.recordedChunks = [];
    return audioBuffer;
  }

  public disarmMicrophone(): void {
    this.isRecording = false;
    if (this.micProcessor) {
      this.micProcessor.disconnect();
      this.micProcessor = null;
    }
    if (this.micMonitorGain) {
      this.micMonitorGain.disconnect();
      this.micMonitorGain = null;
    }
    if (this.micGainNode) {
      this.micGainNode.disconnect();
      this.micGainNode = null;
    }
    if (this.micSource) {
      this.micSource.disconnect();
      this.micSource = null;
    }
    if (this.micStream) {
      for (const track of this.micStream.getTracks()) {
        track.stop();
      }
      this.micStream = null;
    }
    this.micAnalyser = null;
  }

  public getMasterBypass(): boolean {
    return this.mBypass;
  }
}

export const studioEngine = new StudioAudioEngine();
