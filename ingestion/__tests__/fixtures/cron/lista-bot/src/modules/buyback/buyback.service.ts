// @ts-nocheck — fixture
import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

@Injectable()
export class BuybackService {
  /** Daily LISTA buyback */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async runBuyback() { /* impl */ }
}
