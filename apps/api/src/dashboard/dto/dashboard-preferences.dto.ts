import type { WeightUnit } from '@bullion-ledger/shared';

import { IsWeightUnitValue } from '../../common/decorators/validators.js';

export class UpdateDashboardPreferencesDto {
  @IsWeightUnitValue()
  weightUnit!: WeightUnit;
}
