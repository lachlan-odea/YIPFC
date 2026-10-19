import { useEffect, useRef, useState } from 'react'
import { autocomplete, namedExact, type ScryfallCard } from '../lib/scryfall'
import { Icons, errorText } from './ui'
import AddCardPanel from './AddCardPanel'

export default function SearchAdd() {
  const [q, setQ] = useState('')
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [card, setCard] = useState<ScryfallCard | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (card) return
    const t = setTimeout(() => {
      autocomplete(q)
        .then(setSuggestions)
        .catch(() => setSuggestions([]))
    }, 180)
    return () => clearTimeout(t)
  }, [q, card])

  async function pick(name: string) {
    setErr(null)
    try {
      setCard(await namedExact(name))
      setQ(name)
      setSuggestions([])
    } catch (e) {
      setErr(errorText(e))
    }
  }

  function reset() {
    setCard(null)
    setQ('')
    setSuggestions([])
    inputRef.current?.focus()
  }

  return (
    <div className="stack">
      <div className="search">
        <Icons.search />
        <input
          ref={inputRef}
          className="input"
          placeholder="Card name"
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setCard(null)
          }}
          onKeyDown={(e) => e.key === 'Enter' && suggestions[0] && void pick(suggestions[0])}
          autoFocus
          aria-label="Search Scryfall for a card"
        />
      </div>
      {err && <div className="notice warn">{err}</div>}
      {!card && suggestions.length > 0 && (
        <div className="stack" style={{ gap: 4 }} role="listbox" aria-label="Matching cards">
          {suggestions.map((s) => (
            <button key={s} className="btn quiet" style={{ justifyContent: 'flex-start' }} onClick={() => void pick(s)} role="option" aria-selected={false}>
              {s}
            </button>
          ))}
        </div>
      )}
      {card && <AddCardPanel card={card} onChangePrinting={setCard} onAdded={reset} />}
    </div>
  )
}
