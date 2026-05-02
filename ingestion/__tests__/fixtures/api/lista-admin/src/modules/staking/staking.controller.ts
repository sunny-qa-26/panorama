// @ts-nocheck — fixture
import { Controller, Get } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Stake } from '../../entity/staking/stake.entity';

@Controller('staking')
export class StakingController {
  constructor(@InjectRepository(Stake) private readonly stakeRepo: Repository<Stake>) {}

  @Get('summary')
  async summary() { /* impl */ }
}
