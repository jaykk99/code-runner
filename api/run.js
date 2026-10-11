import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';

const execFileAsync = promisify(execFile);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { code } = req.body || {};
  if (!code || code.length > 100000) return res.status(400).json({ error: 'code required (max 100k chars)' });
  const path = join(tmpdir(), `run-${randomUUID()}.js`);
  try {
    await writeFile(path, code);
    const { stdout, stderr } = await execFileAsync('node', [path], { timeout: 20000, maxBuffer: 1024 * 1024 });
    return res.status(200).json({ stdout: stdout.slice(-8000), stderr: stderr.slice(-8000), exitCode: 0 });
  } catch (e) {
    return res.status(200).json({
      stdout: (e.stdout || '').slice(-8000),
      stderr: (e.stderr || e.message || '').slice(-8000),
      exitCode: e.code || 1,
    });
  } finally {
    unlink(path).catch(() => {});
  }
}
