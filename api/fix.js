export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { code = '', stderr = '' } = req.body || {};
  const notes = [];
  let m = stderr.match(/SyntaxError: Unexpected token '([^']+)'/);
  if (m) notes.push(`Syntax error near '${m[1]}'. Check for unclosed brackets, quotes, or a typo on that line.`);
  m = stderr.match(/ReferenceError: (\w+) is not defined/);
  if (m) notes.push(`'${m[1]}' is not defined. Check the spelling or add the missing require/import.`);
  m = stderr.match(/Cannot find module '([^']+)'/);
  if (m) notes.push(`Module '${m[1]}' not found. Bundle it or use a built-in module.`);
  m = stderr.match(/TypeError: ([^\n]+)/);
  if (m) notes.push(`Type error: ${m[1]}. Check that values are the type the code expects.`);
  if (!notes.length) notes.push('No automatic fix found. The stack trace line number points at the problem.');
  return res.status(200).json({ fixed: code, notes, changed: false });
}
