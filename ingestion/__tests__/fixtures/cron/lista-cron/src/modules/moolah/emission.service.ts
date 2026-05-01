// @ts-nocheck — fixture, decorators not resolved
import { Injectable } from '@nestjs/common';
import { XxlJobHandler } from '@xxl/nest';

@Injectable()
export class MoolahEmissionService {
  /** 每周三计算 Merkle Root */
  @XxlJobHandler('moolahEmissionWeeklySnapshot')
  async snapshot() { /* impl */ }

  @XxlJobHandler('moolahEmissionAcceptRoot')
  async accept() { /* impl */ }
}
