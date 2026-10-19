/**
 * Pure text helpers for turning raw OCR output into something Scryfall can
 * look up. Kept free of the Tesseract import so they are cheap to unit test.
 */

/** Turns a raw title read into something Scryfall's fuzzy search can use. */
export function cleanTitle(text: string): string {
  const firstLine = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)[0]
  if (!firstLine) return ''
  return firstLine
    .replace(/[^A-Za-z' ,.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s'.,-]+|[\s'.,-]+$/g, '')
    .trim()
}

export type FooterRead = { set: string; number: string }

const LANG = '(?:EN|DE|FR|IT|ES|PT|JA|JP|KO|RU|ZH|CS|CT|PH)'

/**
 * Pulls the set code and collector number out of a card footer, e.g.
 * "0042/0281 U\nDMU · EN" gives { set: 'dmu', number: '42' }. Returns null
 * when either is missing, which is normal for older frames and promos.
 */
export function parseFooter(text: string): FooterRead | null {
  const num = /(\d{1,4})\s*\/\s*\d{1,4}/.exec(text)
  if (!num) return null
  const number = String(parseInt(num[1], 10))
  // Set code sits before the language on the second line: "DMU · EN", "DMU EN", "DMU-EN".
  const withLang = new RegExp(`\\b([A-Z][A-Z0-9]{2,4})\\b\\s*[·•*-]?\\s*${LANG}\\b`).exec(text)
  let set = withLang?.[1]
  if (!set) {
    // Fall back to the first 3-5 character capital token that is not a language code.
    const tokens = text.replace(num[0], ' ').match(/\b[A-Z][A-Z0-9]{2,4}\b/g) ?? []
    set = tokens.find((t) => !new RegExp(`^${LANG}$`).test(t))
  }
  if (!set) return null
  return { set: set.toLowerCase(), number }
}
