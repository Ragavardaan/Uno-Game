/**
 * Web Audio API synthesizer for 100% reliable local game sound effects
 */

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

export function playSound(type: 'play' | 'draw' | 'uno' | 'error' | 'win' | 'start' | 'shuffle') {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    switch (type) {
      case 'play': {
        // High-speed card flick sweep
        const osc = ctx.createOscillator();
        const gainNode = ctx.createGain();
        osc.connect(gainNode);
        gainNode.connect(ctx.destination);

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(800, now);
        osc.frequency.exponentialRampToValueAtTime(120, now + 0.08);

        gainNode.gain.setValueAtTime(0.18, now);
        gainNode.gain.linearRampToValueAtTime(0.001, now + 0.08);

        osc.start(now);
        osc.stop(now + 0.09);
        break;
      }

      case 'draw': {
        // Whoosh swipe sound
        const osc = ctx.createOscillator();
        const gainNode = ctx.createGain();
        osc.connect(gainNode);
        gainNode.connect(ctx.destination);

        osc.type = 'sine';
        osc.frequency.setValueAtTime(220, now);
        osc.frequency.exponentialRampToValueAtTime(680, now + 0.15);

        gainNode.gain.setValueAtTime(0.15, now);
        gainNode.gain.linearRampToValueAtTime(0.001, now + 0.15);

        osc.start(now);
        osc.stop(now + 0.16);
        break;
      }

      case 'shuffle': {
        // Run a cascade of quick card flicks to mimic card shuffling
        for (let i = 0; i < 6; i++) {
          const delay = i * 0.06;
          setTimeout(() => {
            try {
              const innerCtx = getAudioContext();
              const osc = innerCtx.createOscillator();
              const gainNode = innerCtx.createGain();
              osc.connect(gainNode);
              gainNode.connect(innerCtx.destination);

              osc.type = 'triangle';
              osc.frequency.setValueAtTime(400 + Math.random() * 200, innerCtx.currentTime);
              osc.frequency.exponentialRampToValueAtTime(100, innerCtx.currentTime + 0.05);

              gainNode.gain.setValueAtTime(0.12, innerCtx.currentTime);
              gainNode.gain.linearRampToValueAtTime(0.001, innerCtx.currentTime + 0.05);

              osc.start(innerCtx.currentTime);
              osc.stop(innerCtx.currentTime + 0.06);
            } catch (_) {}
          }, delay * 1000);
        }
        break;
      }

      case 'uno': {
        // Enthusiastic brassy announcement double-chime
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gainNode = ctx.createGain();

        osc1.connect(gainNode);
        osc2.connect(gainNode);
        gainNode.connect(ctx.destination);

        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(392, now); // G4
        osc2.type = 'triangle';
        osc2.frequency.setValueAtTime(440, now); // A4

        // Slide into chord
        osc1.frequency.exponentialRampToValueAtTime(523.25, now + 0.15); // C5
        osc2.frequency.exponentialRampToValueAtTime(659.25, now + 0.15); // E5

        gainNode.gain.setValueAtTime(0.15, now);
        gainNode.gain.linearRampToValueAtTime(0.2, now + 0.1);
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

        osc1.start(now);
        osc2.start(now);
        osc1.stop(now + 0.5);
        osc2.stop(now + 0.5);
        break;
      }

      case 'error': {
        // Low cautionary buzzer
        const osc = ctx.createOscillator();
        const gainNode = ctx.createGain();
        osc.connect(gainNode);
        gainNode.connect(ctx.destination);

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(130, now);
        osc.frequency.linearRampToValueAtTime(110, now + 0.25);

        gainNode.gain.setValueAtTime(0.15, now);
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

        osc.start(now);
        osc.stop(now + 0.26);
        break;
      }

      case 'start': {
        // Fun retro arcade game trigger
        const notes = [261.63, 329.63, 392.00, 523.25]; // C E G C
        notes.forEach((freq, idx) => {
          const playTime = now + (idx * 0.08);
          const oscIndex = ctx.createOscillator();
          const gainIndex = ctx.createGain();
          oscIndex.connect(gainIndex);
          gainIndex.connect(ctx.destination);

          oscIndex.type = 'sine';
          oscIndex.frequency.setValueAtTime(freq, playTime);

          gainIndex.gain.setValueAtTime(0.08, playTime);
          gainIndex.gain.linearRampToValueAtTime(0.001, playTime + 0.15);

          oscIndex.start(playTime);
          oscIndex.stop(playTime + 0.16);
        });
        break;
      }

      case 'win': {
        // Triumphant visual game winning fanfare!
        const chord = [523.25, 659.25, 783.99, 1046.50]; // C5 E5 G5 C6 arpeggio
        chord.forEach((freq, idx) => {
          const playTime = now + (idx * 0.12);
          const oscFan = ctx.createOscillator();
          const gainFan = ctx.createGain();
          oscFan.connect(gainFan);
          gainFan.connect(ctx.destination);

          oscFan.type = 'triangle';
          oscFan.frequency.setValueAtTime(freq, playTime);

          gainFan.gain.setValueAtTime(0.12, playTime);
          gainFan.gain.linearRampToValueAtTime(0.001, playTime + 0.4);

          oscFan.start(playTime);
          oscFan.stop(playTime + 0.45);
        });
        break;
      }
    }
  } catch (error) {
    console.warn('Synthesized playback blocked or failed:', error);
  }
}
