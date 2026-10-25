/**
 * 准备执行验证所需的 peer 依赖。
 *
 * 插件的四个 peerDependencies 由宿主（profile）提供，工作区里通常没有。
 * 源码断言（verify-health-colors / test-queue-order）不需要它们，但
 * scripts/verify-execution.mjs 会真的 import 插件、真的调 apply()，
 * 所以必须有可解析的模块实例。
 *
 * 解析优先级（从高到低）：
 *  1. 工作区 node_modules 里已有的 → 原样保留（可能是宿主同款真实实现）；
 *  2. profile（~/.dsh/profiles/<profile>/node_modules）里的真实包 → 软链，保真；
 *  3. 都没有 → 复制 scripts/test-stubs 下的最小桩（够 apply() 装配即可）。
 *
 * 只操作 node_modules（已 gitignore），不碰仓库内的受版本控制文件。
 */
import { existsSync, mkdirSync, cpSync, symlinkSync, readdirSync, lstatSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const targetRoot = join(root, 'node_modules', '@deepseek-ai');
// 桩放在 scripts/test-stubs/<pkg>/ 而不是 scripts/<x>/node_modules/：
// .gitignore 里的 `node_modules/` 会把后者整棵忽略，桩就提交不进仓库。
const stubRoot = join(here, 'test-stubs');

const PACKAGES = [
  '@deepseek-ai/dsh-typert-protocol',
  '@deepseek-ai/schemastery',
  '@deepseek-ai/dsh-home-paths',
  '@deepseek-ai/dsh-atomic-write',
];

/** 在候选 profile 目录中找真实包 */
function findReal(pkg) {
  const profilesRoot = join(homedir(), '.dsh', 'profiles');
  if (!existsSync(profilesRoot)) return null;
  for (const name of readdirSync(profilesRoot)) {
    const p = join(profilesRoot, name, 'node_modules', pkg);
    if (existsSync(join(p, 'package.json'))) return p;
  }
  return null;
}

mkdirSync(targetRoot, { recursive: true });
const report = [];

for (const pkg of PACKAGES) {
  const target = join(targetRoot, pkg.replace('@deepseek-ai/', ''));
  const short = pkg.replace('@deepseek-ai/', '');

  // 已存在就保留（不覆盖用户可能手动放进来的真实实现）
  if (existsSync(join(target, 'package.json'))) {
    report.push(`${short}: 已存在，保留`);
    continue;
  }

  const real = findReal(pkg);
  if (real) {
    try {
      symlinkSync(real, target, 'dir');
      report.push(`${short}: 软链到 profile 真实包`);
      continue;
    } catch {
      /* 软链失败就退回复制 */
    }
  }

  const stub = join(stubRoot, short);
  if (!existsSync(stub)) {
    report.push(`${short}: 缺失且无桩（执行验证会跳过该依赖相关断言）`);
    continue;
  }
  try {
    cpSync(stub, target, { recursive: true });
    report.push(`${short}: 使用桩`);
  } catch (e) {
    report.push(`${short}: 复制桩失败 ${e.message}`);
  }
}

if (process.argv.includes('--verbose')) {
  for (const line of report) console.log(`  ${line}`);
}
