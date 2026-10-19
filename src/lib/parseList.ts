/**
 * Parses pasted decklists and exported CSVs into card identifiers.
 *
 * Handles the formats people actually paste:
 *   Sol Ring
 *   1 Sol Ring
 *   1x Sol Ring
 *   1 Sol Ring (C21) 263          Moxfield / Archidekt
 *   1 Sol Ring (C21) 263 *F*      Moxfield foil flag
 *   1 Sol Ring [C21]              Deckbox-ish
 *   1 Sol Ring <c21>              some apps
 *   4 Lightning Bolt (2X2) 117 #Burn   Archidekt tags
 *   SIDEBOARD: / Commander / // Lands   section headers are skipped
 *   CSV with Name / Quantity (or Count) / Set (or Edition) / Collector Number columns
 */

export type ParsedLine = {
  raw: string
  quantity: number
  name: string
  set?: string
  collector_number?: string
  foil?: boolean
}

export type ParseResult = { lines: ParsedLine[]; skipped: string[] }

const HEADER = /^(deck|commander|companion|sideboard|maybeboard|main|mainboard|lands|creatures|spells|artifacts|enchantments|planeswalkers|instants|sorceries|tokens|considering)\b[:\s]*$/i

export function parseList(text: string): ParseResult {
  if (looksLikeCsv(text)) return parseCsv(text)
  const lines: ParsedLine[] = []
  const skipped: string[] = []
  for (const rawLine of text.split(/\r?\n/)) {
    const raw = rawLine.trim()
    if (!raw) continue
    if (raw.startsWith('//') || raw.startsWith('#') || HEADER.test(raw)) continue
    const parsed = parseLine(raw)
    if (parsed) lines.push(parsed)
    else skipped.push(raw)
  }
  return { lines: mergeDuplicates(lines), skipped }
}

export function parseLine(raw: string): ParsedLine | null {
  let rest = raw.trim()
  let quantity = 1
  let foil = false

  const qty = rest.match(/^(\d+)\s*[xX]?\s+(.*)$/)
  if (qty) {
    quantity = parseInt(qty[1], 10)
    rest = qty[2]
  }
  // Trailing "x2" style: "Sol Ring x2"
  const trailingQty = rest.match(/^(.*?)\s+[xX](\d+)$/)
  if (trailingQty) {
    rest = trailingQty[1]
    quantity = parseInt(trailingQty[2], 10)
  }

  // Strip Archidekt-style tags and categories: "#Burn", "[Ramp]" at the very end.
  rest = rest.replace(/\s+#\S+/g, '').replace(/\s+\^[^^]*\^/g, '')

  if (/\*F\*|\(foil\)|\bfoil\b/i.test(rest)) {
    foil = true
    rest = rest.replace(/\s*\*F\*\s*|\s*\(foil\)\s*|\s+foil\s*$/gi, ' ').trim()
  }

  let set: string | undefined
  let collector: string | undefined

  // "(C21) 263" or "(C21)" or "[C21]" or "<c21>"
  const setMatch = rest.match(/^(.*?)\s*[(\[<]([A-Za-z0-9]{2,6})[)\]>]\s*([A-Za-z0-9★-]+)?\s*$/)
  if (setMatch && !looksLikeNameParen(setMatch[2])) {
    rest = setMatch[1]
    set = setMatch[2].toLowerCase()
    collector = setMatch[3]
  }

  const name = rest.replace(/\s+/g, ' ').trim()
  if (!name || !/[A-Za-z]/.test(name)) return null
  if (!Number.isFinite(quantity) || quantity < 1) quantity = 1

  return { raw, quantity, name, set, collector_number: collector, foil: foil || undefined }
}

// A few real card names end in a parenthetical that is not a set code.
function looksLikeNameParen(code: string) {
  return /^(a|b|c|d|e|f|g|h|i|j|k|l|m|n|o|p|q|r|s|t|u|v|w|x|y|z)$/i.test(code)
}

function mergeDuplicates(lines: ParsedLine[]): ParsedLine[] {
  const byKey = new Map<string, ParsedLine>()
  for (const line of lines) {
    const key = `${line.name.toLowerCase()}|${line.set ?? ''}|${line.collector_number ?? ''}`
    const existing = byKey.get(key)
    if (existing) existing.quantity += line.quantity
    else byKey.set(key, { ...line })
  }
  return [...byKey.values()]
}

function looksLikeCsv(text: string): boolean {
  const first = text.split(/\r?\n/).find((l) => l.trim())
  if (!first) return false
  const cells = splitCsvLine(first).map((c) => c.trim().toLowerCase())
  return cells.length >= 2 && cells.some((c) => c === 'name' || c === 'card name' || c === 'card')
}

export function parseCsv(text: string): ParseResult {
  const rows = text.split(/\r?\n/).filter((l) => l.trim())
  const header = splitCsvLine(rows[0]).map((c) => c.trim().toLowerCase())
  const col = (...names: string[]) => header.findIndex((h) => names.includes(h))
  const iName = col('name', 'card name', 'card')
  const iQty = col('quantity', 'count', 'qty', 'amount')
  const iSet = col('set', 'set code', 'edition', 'edition code', 'set_code')
  const iNum = col('collector number', 'collector_number', 'card number', 'number', 'cn')
  const iFoil = col('foil', 'finish', 'printing')

  const lines: ParsedLine[] = []
  const skipped: string[] = []
  for (const row of rows.slice(1)) {
    const cells = splitCsvLine(row)
    const name = (cells[iName] ?? '').trim()
    if (!name) {
      skipped.push(row)
      continue
    }
    const quantity = iQty >= 0 ? parseInt(cells[iQty] ?? '1', 10) || 1 : 1
    const setRaw = iSet >= 0 ? (cells[iSet] ?? '').trim() : ''
    // Some exports give the full set name instead of a code; only keep short codes.
    const set = /^[A-Za-z0-9]{2,6}$/.test(setRaw) ? setRaw.toLowerCase() : undefined
    const collector_number = iNum >= 0 ? (cells[iNum] ?? '').trim() || undefined : undefined
    const foilRaw = iFoil >= 0 ? (cells[iFoil] ?? '').trim().toLowerCase() : ''
    const foil = foilRaw === 'foil' || foilRaw === 'true' || foilRaw === 'yes' || foilRaw === '1' || undefined
    lines.push({ raw: row, quantity, name, set, collector_number: set ? collector_number : undefined, foil })
  }
  return { lines: mergeDuplicates(lines), skipped }
}

export function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (ch === '"') quoted = false
      else cur += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out
}
