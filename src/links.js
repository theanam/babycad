/**
 * Where BabyCAD points people who want the source, a bug report or a word
 * with whoever made this. One place, because these strings show up in the top
 * bar, the welcome screen and the help sheet.
 */
export const REPO_URL = 'https://github.com/theanam/babycad'
export const ISSUES_URL = `${REPO_URL}/issues`
export const FEEDBACK_EMAIL = 'anam.ahmed.a@gmail.com'

// A pre-filled subject line, so a mail that arrives out of nowhere still says
// what it is about.
export const FEEDBACK_MAILTO = `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(
  'BabyCAD feedback'
)}`
