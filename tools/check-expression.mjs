/**
 * Expression check:  `node tools/check-expression.mjs`
 *
 * The arithmetic a number box accepts. It reads four operators, brackets, a
 * leading sign and `PI`, and nothing else — deliberately, because the obvious
 * version of this hands whatever was typed to `eval`, and a page holding
 * somebody's work should not have that door in it.
 *
 * So this checks two things in equal measure: that real sums come out right,
 * and that everything which is not a sum comes back as nothing at all rather
 * than as a number, an exception, or an instruction being carried out.
 */
import { register } from 'node:module'

register('./resolve-extensionless.mjs', import.meta.url)

const { evaluate } = await import('../src/scene/expression.js')

let problems = 0
const fail = (message) => {
  console.log(`  BAD ${message}`)
  problems++
}

console.log('\nsums come out right…')
const sums = [
  ['12', 12],
  ['-4', -4],
  ['2+3', 5],
  ['10 - 2.5', 7.5],
  ['6*7', 42],
  ['600/4', 150],
  ['2+3*4', 14], // times before plus
  ['(2+3)*4', 20],
  ['-(3+4)', -7],
  ['2*-3', -6],
  ['PI', Math.PI],
  ['pi', Math.PI],
  ['PI*50', Math.PI * 50],
  ['2*PI*12', 2 * Math.PI * 12],
  ['25.4/2', 12.7],
  ['1+2+3+4', 10],
  ['100/4/5', 5], // left to right
  ['10-2-3', 5],
  ['  8  /  2  ', 4],
  ['((1+1))*3', 6],
]
for (const [text, want] of sums) {
  const got = evaluate(text)
  if (got === null || Math.abs(got - want) > 1e-9) {
    fail(`${JSON.stringify(text)} came back ${got}, expected ${want}`)
  }
}
if (!problems) console.log(`  ok  all ${sums.length} of them`)

console.log('\nand anything that is not a sum comes back as nothing…')
const nonsense = [
  '', '   ', 'abc', 'hello world', '2 3', '4 )', '(1+2', '1++', '*3', '1/0',
  'alert(1)', 'window', 'PI()', '2^8', '0x10', '1,5', '.', '--', 'Math.PI',
  'constructor', '[1]', '{}', 'this', 'process.exit(1)', '1;2',
]
let leaked = 0
for (const text of nonsense) {
  let got
  try {
    got = evaluate(text)
  } catch (error) {
    fail(`${JSON.stringify(text)} threw — ${error.message}`)
    continue
  }
  if (got !== null) {
    fail(`${JSON.stringify(text)} came back as ${got}`)
    leaked++
  }
}
if (!leaked) console.log(`  ok  all ${nonsense.length} of them, including the ones that look like code`)

console.log('\nand a plain number still behaves as it always did…')
{
  // This stands in for `parseFloat` in the fields, so it has to agree with it
  // on the things people actually type.
  const same = ['0', '7', '12.5', '0.4', '-3.25', '1000']
  const off = same.filter((t) => evaluate(t) !== Number.parseFloat(t))
  if (off.length) fail(`disagrees with parseFloat on ${off.join(', ')}`)
  else console.log(`  ok  ${same.length} plain numbers read the same as before`)

  // Where it deliberately differs: parseFloat takes the first number it sees
  // and shrugs off the rest, which is how "12abc" became 12 and "2 3" became
  // 2. A box that does arithmetic cannot also do that — it would read a typo
  // as an answer.
  const loose = ['12abc', '2 3', '5 apples']
  const taken = loose.filter((t) => evaluate(t) !== null)
  if (taken.length) fail(`still reads a number out of ${taken.join(', ')}`)
  else console.log('  ok  half-typed nonsense is refused rather than half-read')
}

console.log(problems ? `\n${problems} problem${problems === 1 ? '' : 's'}` : '\nall clear')
process.exit(problems ? 1 : 0)
