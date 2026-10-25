/** 仅提供基类：执行验证不需要真实 RPC 网关。 */
export class TypertRemoteService {
  constructor(ctx, config) { this.ctx = ctx; this.config = config || {}; }
}
