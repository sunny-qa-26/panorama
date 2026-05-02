// @ts-nocheck — fixture
import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('stake_record')
export class StakeRecord {
  @PrimaryColumn() user!: string;
  @Column() amount!: string;
}
