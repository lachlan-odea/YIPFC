import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { ReactNode } from 'react'
import { Icons } from './ui'

export type RadialItem = {
  label: string
  icon: ReactNode
  onPick: () => void
  disabled?: boolean
  danger?: boolean
}

const HOLD = 350
const RADIUS = 92
const HIT = 36

function buzz(ms: number) {
  try {
    navigator.vibrate?.(ms)
  } catch {
    /* not supported */
  }
}

/**
 * The dice button. Tap for the full menu; hold and shortcuts fan out around
 * it. Slide onto one and let go, or let go first and tap one. `arc` is the
 * sweep they fan across: a full circle, or just the top half when the
 * button sits at the bottom of the screen.
 */
export function DiceButton({ items, onTap, arc = 'full', className = '' }: { items: RadialItem[]; onTap: () => void; arc?: 'full' | 'top'; className?: string }) {
  const btn = useRef<HTMLButtonElement>(null)
  const timer = useRef(0)
  const [open, setOpen] = useState<{ cx: number; cy: number } | null>(null)
  const [hot, setHot] = useState<number | null>(null)
  const held = useRef(false)

  const positions = useCallback(
    (cx: number, cy: number) =>
      items.map((_, i) => {
        // Start at the top and go clockwise; a top-only arc spreads from left to right over the button.
        const a = arc === 'full' ? -Math.PI / 2 + (i / items.length) * 2 * Math.PI : Math.PI + (i / (items.length - 1)) * Math.PI
        return { x: cx + RADIUS * Math.cos(a), y: cy + RADIUS * Math.sin(a) }
      }),
    [items, arc],
  )

  const close = useCallback(() => {
    setOpen(null)
    setHot(null)
  }, [])

  useEffect(() => () => clearTimeout(timer.current), [])

  const nearest = (o: { cx: number; cy: number }, x: number, y: number) => {
    let best: number | null = null
    let bestD = HIT
    positions(o.cx, o.cy).forEach((p, i) => {
      const d = Math.hypot(p.x - x, p.y - y)
      if (d < bestD && !items[i].disabled) {
        best = i
        bestD = d
      }
    })
    return best
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* fine */
    }
    held.current = false
    clearTimeout(timer.current)
    const r = e.currentTarget.getBoundingClientRect()
    const centre = { cx: r.left + r.width / 2, cy: r.top + r.height / 2 }
    timer.current = window.setTimeout(() => {
      held.current = true
      setOpen(centre)
      buzz(15)
    }, HOLD)
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!open) return
    setHot(nearest(open, e.clientX, e.clientY))
  }
  const onPointerUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    clearTimeout(timer.current)
    if (!held.current) {
      onTap()
      return
    }
    if (!open) return
    const i = nearest(open, e.clientX, e.clientY)
    if (i !== null) {
      close()
      buzz(10)
      items[i].onPick()
    }
    // Released on the button itself: leave the shortcuts up to tap.
  }
  const onPointerCancel = () => clearTimeout(timer.current)

  return (
    <>
      <button
        ref={btn}
        className={`life-menu-btn ${className}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onClick={(e) => {
          // Keyboard activation only: pointer taps are handled on pointerup.
          if (e.detail === 0) onTap()
        }}
        onContextMenu={(e) => e.preventDefault()}
        aria-label="Game menu"
        aria-haspopup="menu"
        aria-expanded={!!open}
        title="Tap for the menu, hold for shortcuts"
      >
        <Icons.dice />
      </button>
      {open && (
        <div className="radial-scrim" onClick={close} onContextMenu={(e) => e.preventDefault()}>
          {positions(open.cx, open.cy).map((p, i) => {
            const it = items[i]
            return (
              <button
                key={it.label}
                className={`radial-item ${hot === i ? 'hot' : ''} ${it.danger ? 'danger' : ''}`}
                style={{ left: p.x, top: p.y, animationDelay: `${i * 18}ms` }}
                disabled={it.disabled}
                onClick={(e) => {
                  e.stopPropagation()
                  close()
                  it.onPick()
                }}
                role="menuitem"
              >
                <span className="ico" aria-hidden="true">
                  {it.icon}
                </span>
                {it.label}
              </button>
            )
          })}
        </div>
      )}
    </>
  )
}
