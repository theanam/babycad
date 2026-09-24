/**
 * Arithmetic in a number box.
 *
 * A variable is a number somebody worked out, and the working is often the
 * interesting part: a shelf is `600 / 4`, a bolt circle is `PI * 50`, a wall
 * is `2.4 * 3`. Made to do the sum themselves, people either reach for a
 * calculator or round it, and the rounded one is the one that ends up in the
 * model.
 *
 * So the box takes the sum. Plus, minus, times, divide, brackets, a leading
 * minus, and `PI` — which is the one constant that comes up over and over in a
 * program about round things and is the one nobody can type from memory past
 * the third digit.
 *
 * A sum can also name other variables — `wall * 2`, `width - clearance` — and
 * those are not read once and forgotten: the sum is kept, and the variable
 * follows whatever it was built out of. `scene/variables` owns the part that
 * makes that work, which is deciding what has to be worked out before what,
 * and refusing a sum that would end up waiting on itself.
 *
 * **Why not `eval`.** The obvious three-line version of this hands whatever
 * was typed to the JavaScript engine. In a page that holds somebody's work and
 * talks to their clipboard, that is a door left open for the sake of saving an
 * afternoon. This reads the four operators and nothing else, so the worst a
 * strange string can do is fail to parse.
 */

const CONSTANTS = { pi: Math.PI }

/** Look a name up: as written first, then ignoring case. */
function lookUp(name, scope) {
  if (!scope) return undefined
  const direct = scope instanceof Map ? scope.get(name) : scope[name]
  if (typeof direct === 'number') return direct
  const entries = scope instanceof Map ? [...scope] : Object.entries(scope)
  const lower = name.toLowerCase()
  const found = entries.find(([key]) => key.toLowerCase() === lower)
  return typeof found?.[1] === 'number' ? found[1] : undefined
}

/**
 * Every name a sum mentions that is not a constant of its own.
 *
 * What one variable is built out of, in other words — which is what lets the
 * ordering be worked out before anything is evaluated.
 */
export function namesIn(text) {
  const out = []
  for (const match of String(text ?? '').matchAll(/[a-z_][a-z_0-9]*/gi)) {
    const name = match[0]
    if (name.toLowerCase() in CONSTANTS) continue
    if (!out.includes(name)) out.push(name)
  }
  return out
}

/** Split into numbers, names, operators and brackets. Null if anything else. */
function tokenise(text, scope) {
  const out = []
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (c === ' ' || c === '\t') {
      i++
      continue
    }
    if ('+-*/()'.includes(c)) {
      out.push({ kind: c })
      i++
      continue
    }
    // A number, possibly with a decimal point. A bare point is not one.
    if (/[0-9.]/.test(c)) {
      let j = i
      while (j < text.length && /[0-9.]/.test(text[j])) j++
      const value = Number(text.slice(i, j))
      if (!Number.isFinite(value)) return null
      out.push({ kind: 'number', value })
      i = j
      continue
    }
    if (/[a-z_]/i.test(c)) {
      let j = i
      while (j < text.length && /[a-z_0-9]/i.test(text[j])) j++
      const name = text.slice(i, j)
      const constant = CONSTANTS[name.toLowerCase()]
      const named = constant ?? lookUp(name, scope)
      // A name nobody has heard of is not a number, and guessing zero for it
      // would turn a typo into a silently wrong model.
      if (typeof named !== 'number') return null
      out.push({ kind: 'number', value: named })
      i = j
      continue
    }
    return null
  }
  return out
}

/**
 * Work out what was typed, or null if it is not a sum.
 *
 * Plain numbers go through unchanged, so this can stand in wherever a field
 * used to call `parseFloat` without changing what typing `12` does. `scope`
 * gives the other variables by name; without it a sum that mentions one is
 * refused rather than guessed at.
 */
export function evaluate(text, scope) {
  const tokens = tokenise(String(text ?? ''), scope)
  if (!tokens?.length) return null

  let at = 0
  const peek = () => tokens[at]?.kind
  const take = () => tokens[at++]

  // expression := term (('+' | '-') term)*
  const expression = () => {
    let left = term()
    if (left === null) return null
    while (peek() === '+' || peek() === '-') {
      const op = take().kind
      const right = term()
      if (right === null) return null
      left = op === '+' ? left + right : left - right
    }
    return left
  }

  // term := factor (('*' | '/') factor)*
  const term = () => {
    let left = factor()
    if (left === null) return null
    while (peek() === '*' || peek() === '/') {
      const op = take().kind
      const right = factor()
      if (right === null) return null
      // Dividing by nothing is not an answer, and infinity in a size is worse
      // than a refusal: the box keeps what it had and nothing is disturbed.
      if (op === '/' && right === 0) return null
      left = op === '*' ? left * right : left / right
    }
    return left
  }

  // factor := ('-' | '+') factor | number | '(' expression ')'
  const factor = () => {
    if (peek() === '-') {
      take()
      const inner = factor()
      return inner === null ? null : -inner
    }
    if (peek() === '+') {
      take()
      return factor()
    }
    if (peek() === 'number') return take().value
    if (peek() === '(') {
      take()
      const inner = expression()
      if (inner === null || peek() !== ')') return null
      take()
      return inner
    }
    return null
  }

  const value = expression()
  // Anything left over means it was not a sum after all — "2 3" or "4 )".
  if (value === null || at !== tokens.length || !Number.isFinite(value)) return null
  return value
}
