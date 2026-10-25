import { writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
export async function writeFileAtomic(p, data) {
  await mkdir(dirname(p), { recursive: true });
  const tmp = p + '.tmp-' + process.pid;
  await writeFile(tmp, data);
  await rename(tmp, p);
  return true;
}
export default { writeFileAtomic };
