// A cheesy, original bubblegum-pop loop, synthesised with Web Audio (no files).
// C – G – Am – F at 128 BPM: square-wave lead, bouncing octave bass, kick/snare/hats.
// Browsers only allow sound after a user gesture, so call start() from a click/keypress.

const BPM = 128
const EIGHTH = 60 / BPM / 2

// MIDI note numbers. Melody: one entry per eighth note, 8 bars × 8 eighths; null = rest.
const _ = null
const C5 = 72, D5 = 74, E5 = 76, F5 = 77, G5 = 79, A5 = 81, B5 = 83, C6 = 84
const MELODY: (number | null)[] = [
  E5, G5, C6, G5, E5, G5, C6, _, //  C
  D5, G5, B5, G5, D5, G5, B5, _, //  G
  C5, E5, A5, E5, C5, E5, A5, G5, // Am
  F5, A5, C6, A5, G5, F5, E5, D5, //  F
  E5, _, E5, F5, G5, _, G5, _, //    C
  B5, _, A5, G5, D5, _, _, _, //     G
  C6, _, B5, A5, E5, _, A5, B5, //   Am
  C6, _, A5, _, G5, _, _, _, //      F
]
const BASS_ROOTS = [36, 43, 45, 41] // C2 G2 A2 F2, one per bar, repeating

const midiHz = (n: number) => 440 * 2 ** ((n - 69) / 12)

export function createSong() {
  let ctx: AudioContext | null = null
  let master: GainNode
  let noise: AudioBuffer
  let timer = 0
  let step = 0
  let nextTime = 0
  let muted = false

  function tone(type: OscillatorType, freq: number, t: number, dur: number, gain: number) {
    const osc = ctx!.createOscillator()
    const env = ctx!.createGain()
    osc.type = type
    osc.frequency.value = freq
    env.gain.setValueAtTime(0, t)
    env.gain.linearRampToValueAtTime(gain, t + 0.005)
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    osc.connect(env).connect(master)
    osc.start(t)
    osc.stop(t + dur + 0.02)
  }

  function kick(t: number) {
    const osc = ctx!.createOscillator()
    const env = ctx!.createGain()
    osc.frequency.setValueAtTime(150, t)
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.12)
    env.gain.setValueAtTime(0.9, t)
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.2)
    osc.connect(env).connect(master)
    osc.start(t)
    osc.stop(t + 0.22)
  }

  function hiss(t: number, dur: number, gain: number, filterType: BiquadFilterType, freq: number) {
    const src = ctx!.createBufferSource()
    src.buffer = noise
    const filter = ctx!.createBiquadFilter()
    filter.type = filterType
    filter.frequency.value = freq
    const env = ctx!.createGain()
    env.gain.setValueAtTime(gain, t)
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    src.connect(filter).connect(env).connect(master)
    src.start(t)
    src.stop(t + dur + 0.02)
  }

  function schedule(s: number, t: number) {
    const inBar = s % 8
    const bar = Math.floor(s / 8)
    // Lead
    const note = MELODY[s % MELODY.length]
    if (note !== null) tone('square', midiHz(note), t, EIGHTH * 0.9, 0.07)
    // Bass: root / octave bounce on every eighth
    const root = BASS_ROOTS[bar % BASS_ROOTS.length]
    tone('triangle', midiHz(inBar % 2 ? root + 12 : root), t, EIGHTH * 0.8, 0.22)
    // Drums: four-on-the-floor kick, snare on 2 and 4, off-beat hats
    if (inBar % 2 === 0) kick(t)
    if (inBar === 2 || inBar === 6) hiss(t, 0.14, 0.25, 'bandpass', 1800)
    if (inBar % 2 === 1) hiss(t, 0.04, 0.12, 'highpass', 7000)
  }

  function tick() {
    while (nextTime < ctx!.currentTime + 0.12) {
      schedule(step, nextTime)
      step++
      nextTime += EIGHTH
    }
  }

  return {
    /** Start (or resume) the loop. Must be called from a user gesture. */
    async start() {
      if (!ctx) {
        ctx = new AudioContext()
        master = ctx.createGain()
        master.gain.value = muted ? 0 : 0.5
        master.connect(ctx.destination)
        noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
        const data = noise.getChannelData(0)
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
        nextTime = ctx.currentTime + 0.05
        timer = window.setInterval(tick, 25)
      }
      if (ctx.state === 'suspended') await ctx.resume()
    },
    get started() { return ctx !== null && ctx.state === 'running' },
    get muted() { return muted },
    setMuted(m: boolean) {
      muted = m
      if (ctx) master.gain.setTargetAtTime(m ? 0 : 0.5, ctx.currentTime, 0.02)
    },
    stop() {
      window.clearInterval(timer)
      ctx?.close()
      ctx = null
    },
  }
}
