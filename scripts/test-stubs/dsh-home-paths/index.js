import { join } from 'node:path';
/** 测试用：把 DSH_HOME 指到 tmp 目录，避免碰到真实 state 文件。 */
export function dshHomePath(...parts) {
  return join(process.env.FQ_TEST_HOME || '/tmp/fq-harness/home', ...parts);
}
export default { dshHomePath };
