/**
 * The little "got it" blip and buzz when a card is recognised. Browsers only
 * let audio start after a user gesture, so unlock() is wired to the first tap
 * anywhere on the page; before that the blip is silently skipped.
 */

let ctx: AudioContext | null = null

export function unlockAudio() {
  try {
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
  } catch {
    ctx = null
  }
}

export function scanFeedback(kind: 'added' | 'again' = 'added') {
  try {
    navigator.vibrate?.(kind === 'added' ? 35 : [20, 40, 20])
  } catch {
    /* not supported */
  }
  if (!ctx || ctx.state !== 'running') return
  try {
    const t = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(kind === 'added' ? 880 : 660, t)
    if (kind === 'again') osc.frequency.setValueAtTime(880, t + 0.07)
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(0.18, t + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.14)
    osc.connect(gain).connect(ctx.destination)
    osc.start(t)
    osc.stop(t + 0.15)
  } catch {
    /* audio is a nicety */
  }
}
