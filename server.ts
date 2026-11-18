import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured. Please add it in Settings > Secrets.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '4mb' }));

  // AI Noise Profiling & Vocal-Preserving Filter Calibration
  app.post('/api/ai/analyze-noise', async (req: Request, res: Response) => {
    try {
      const {
        trackName,
        instrument,
        noiseFloorDb,
        peakDb,
        hum50HzRatio,
        hum60HzRatio,
        subRumbleRatio,
        vocalFormantEnergyRatio,
        sibilanceRatio,
        durationSec,
        sampleRate,
      } = req.body ?? {};

      if (typeof noiseFloorDb !== 'number' || typeof peakDb !== 'number') {
        res.status(400).json({ error: 'Invalid acoustic telemetry payload.' });
        return;
      }

      const ai = getGeminiClient();

      const prompt = [
        'Analyze this raw microphone track spectral telemetry and return precision DSP noise-removal parameters that preserve the artist\'s natural vocal timbre, formants, and breath harmonics without robotic artifacts.',
        `Track Name: ${String(trackName || 'Vocal Track')}`,
        `Instrument / Source: ${String(instrument || 'Lead Vocal')}`,
        `Duration: ${Number(durationSec || 0).toFixed(2)}s at ${Number(sampleRate || 48000)}Hz`,
        `Noise Floor (quietest 15% frames): ${noiseFloorDb.toFixed(1)} dBFS`,
        `Peak Level: ${peakDb.toFixed(1)} dBFS`,
        `50Hz Mains Hum Energy Ratio: ${(Number(hum50HzRatio || 0) * 100).toFixed(2)}%`,
        `60Hz Mains Hum Energy Ratio: ${(Number(hum60HzRatio || 0) * 100).toFixed(2)}%`,
        `Sub-80Hz Rumble Ratio: ${(Number(subRumbleRatio || 0) * 100).toFixed(2)}%`,
        `Vocal Formant Band (220Hz-3.8kHz) Ratio: ${(Number(vocalFormantEnergyRatio || 0) * 100).toFixed(2)}%`,
        `Sibilance (5.5kHz-9kHz) Ratio: ${(Number(sibilanceRatio || 0) * 100).toFixed(2)}%`,
      ].join('\n');

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          systemInstruction:
            'You are a world-class mastering and audio restoration engineer. Output precise, conservative DSP filter settings that eliminate room noise, electrical hum, and rumble while strictly protecting the artist\'s real voice fundamentals and formant warmth (180Hz-4.2kHz). Never over-suppress.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              highpassHz: {
                type: Type.NUMBER,
                description: 'High-pass rumble cut frequency between 30 and 140 Hz.',
              },
              humNotchHz: {
                type: Type.NUMBER,
                description: 'Mains hum notch frequency: 0 (off), 50, or 60.',
              },
              denoiseStrength: {
                type: Type.NUMBER,
                description: 'Spectral denoise strength from 0.15 to 0.85.',
              },
              vocalPreserveMode: {
                type: Type.BOOLEAN,
                description: 'Always true for vocal/acoustic sources to protect formants.',
              },
              deEssDb: {
                type: Type.NUMBER,
                description: 'Gentle sibilance attenuation between 0 and 6 dB.',
              },
              detectedNoiseSources: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: 'Short list of identified background noise traits.',
              },
              voicePreservationNotes: {
                type: Type.STRING,
                description: 'Concise 1-2 sentence explanation of how the artist voice is kept intact.',
              },
              recommendedPresetName: {
                type: Type.STRING,
                description: 'Short clean profile name (2-4 words).',
              },
            },
            required: [
              'highpassHz',
              'humNotchHz',
              'denoiseStrength',
              'vocalPreserveMode',
              'deEssDb',
              'detectedNoiseSources',
              'voicePreservationNotes',
              'recommendedPresetName',
            ],
          },
        },
      });

      const rawText = (response.text ?? '').trim();
      if (!rawText) {
        res.status(502).json({ error: 'Gemini returned an empty audio analysis response.' });
        return;
      }

      const parsed = JSON.parse(rawText);
      res.json(parsed);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to analyze track noise profile.';
      console.error('Error in /api/ai/analyze-noise:', err);
      res.status(500).json({ error: message });
    }
  });

  // AI Mastering Engineer Preset Calibration
  app.post('/api/ai/mastering-preset', async (req: Request, res: Response) => {
    try {
      const {
        projectTitle,
        genre,
        targetLufs,
        integratedLufs,
        shortTermPeakDb,
        crestFactorDb,
        lowEnergyRatio,
        lowMidEnergyRatio,
        presenceEnergyRatio,
        airEnergyRatio,
        hasVocals,
      } = req.body ?? {};

      if (typeof integratedLufs !== 'number') {
        res.status(400).json({ error: 'Invalid mixdown telemetry payload.' });
        return;
      }

      const ai = getGeminiClient();

      const prompt = [
        'Analyze this multi-track mixdown telemetry and design a transparent, musical mastering chain that achieves the target loudness while keeping the lead artist\'s real voice clear, warm, and un-squashed.',
        `Project: ${String(projectTitle || 'Untitled Session')}`,
        `Genre: ${String(genre || 'Contemporary')}`,
        `Target Loudness: ${Number(targetLufs || -14)} LUFS`,
        `Current Mix Integrated Loudness: ${integratedLufs.toFixed(1)} LUFS`,
        `Current Peak: ${Number(shortTermPeakDb || -3).toFixed(1)} dBFS`,
        `Crest Factor (Dynamic Range): ${Number(crestFactorDb || 10).toFixed(1)} dB`,
        `Low Band (20-180Hz) Share: ${(Number(lowEnergyRatio || 0.25) * 100).toFixed(1)}%`,
        `Low-Mid Band (180-800Hz) Share: ${(Number(lowMidEnergyRatio || 0.3) * 100).toFixed(1)}%`,
        `Vocal Presence (800Hz-5kHz) Share: ${(Number(presenceEnergyRatio || 0.3) * 100).toFixed(1)}%`,
        `Air Band (5kHz-18kHz) Share: ${(Number(airEnergyRatio || 0.15) * 100).toFixed(1)}%`,
        `Contains Real Vocals: ${Boolean(hasVocals) ? 'Yes' : 'No'}`,
      ].join('\n');

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          systemInstruction:
            'You are a senior mastering engineer. Return subtle, musical mastering parameters in valid ranges. Keep EQ adjustments within -4 to +4 dB, preserve vocal clarity, and prevent over-limiting.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              eqLowDb: { type: Type.NUMBER, description: 'Low shelf EQ (-6 to +6 dB)' },
              eqMidDb: { type: Type.NUMBER, description: 'Low-mid clarity bell (-6 to +6 dB)' },
              eqHighDb: { type: Type.NUMBER, description: 'Presence EQ (-6 to +6 dB)' },
              eqAirDb: { type: Type.NUMBER, description: 'Air shelf 12kHz (-6 to +6 dB)' },
              stereoWidth: { type: Type.NUMBER, description: 'Stereo width multiplier (0.85 to 1.35)' },
              compThresholdDb: { type: Type.NUMBER, description: 'Glue compressor threshold (-24 to -6 dB)' },
              compRatio: { type: Type.NUMBER, description: 'Glue compressor ratio (1.5 to 4.0)' },
              limiterCeilingDb: { type: Type.NUMBER, description: 'True-peak limiter ceiling (-2.0 to -0.3 dBFS)' },
              limiterDriveDb: { type: Type.NUMBER, description: 'Limiter input drive (0 to 9 dB)' },
              presetName: { type: Type.STRING, description: 'Clean 2-4 word mastering preset name' },
              engineerSummary: { type: Type.STRING, description: '2 concise sentences explaining tonal balance and dynamics.' },
              vocalClarityAdvice: { type: Type.STRING, description: '1 concise sentence on vocal preservation in the master.' },
            },
            required: [
              'eqLowDb',
              'eqMidDb',
              'eqHighDb',
              'eqAirDb',
              'stereoWidth',
              'compThresholdDb',
              'compRatio',
              'limiterCeilingDb',
              'limiterDriveDb',
              'presetName',
              'engineerSummary',
              'vocalClarityAdvice',
            ],
          },
        },
      });

      const rawText = (response.text ?? '').trim();
      if (!rawText) {
        res.status(502).json({ error: 'Gemini returned an empty mastering response.' });
        return;
      }

      const parsed = JSON.parse(rawText);
      res.json(parsed);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to generate mastering preset.';
      console.error('Error in /api/ai/mastering-preset:', err);
      res.status(500).json({ error: message });
    }
  });

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`SonaVault Studio server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
