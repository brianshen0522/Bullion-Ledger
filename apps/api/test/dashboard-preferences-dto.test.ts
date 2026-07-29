import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';

import { UpdateDashboardPreferencesDto } from '../src/dashboard/dto/dashboard-preferences.dto.js';

describe('UpdateDashboardPreferencesDto', () => {
  it.each(['g', 'kg', 'troy_oz', 'qian'])(
    'accepts the supported weight unit %s',
    async (weightUnit) => {
      expect(
        await validate(plainToInstance(UpdateDashboardPreferencesDto, { weightUnit })),
      ).toEqual([]);
    },
  );

  it.each(['oz', '', 'G', null, {}, 1])(
    'rejects an unsupported weight unit: %j',
    async (weightUnit) => {
      expect(
        await validate(plainToInstance(UpdateDashboardPreferencesDto, { weightUnit })),
      ).not.toHaveLength(0);
    },
  );
});
