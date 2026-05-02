// @ts-nocheck — fixture
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Moolah market metadata */
@Entity('moolah_market')
export class MoolahMarket {
  @PrimaryGeneratedColumn() id!: number;
  @Column() address!: string;
  @Column({ name: 'market_id' }) marketId!: string;
  @Column({ type: 'int', nullable: true }) blockNumber!: number;
}
