// @ts-nocheck — fixture
import { Controller, Get, Post, UseGuards, Query } from '@nestjs/common';

@Controller('moolah')
export class MoolahController {
  /** Search vaults */
  @Get('vault/search')
  async searchVaults(@Query('q') q: string) { /* impl */ }

  @UseGuards(AdminGuard)
  @Post('vault/create')
  async createVault() { /* impl */ }

  /** Run cron via proxy */
  @Post('rebuild')
  async rebuild() {
    return callCronApi('/cron/moolahRebuild');
  }
}
