import { Body, Controller, Get, Patch, UnauthorizedException } from '@nestjs/common';

import { DashboardService } from './dashboard.service.js';
import { CurrentUser, type AuthContext } from '../common/decorators/current-user.decorator.js';
import { UpdateDashboardPreferencesDto } from './dto/dashboard-preferences.dto.js';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('summary')
  summary(@CurrentUser() user: AuthContext | null) {
    return this.dashboard.summary(requireUser(user).userId);
  }

  @Patch('preferences')
  updatePreferences(
    @Body() dto: UpdateDashboardPreferencesDto,
    @CurrentUser() user: AuthContext | null,
  ) {
    const auth = requireUser(user);
    return this.dashboard.updateWeightUnit(auth.userId, dto.weightUnit, auth.sessionId);
  }
}

function requireUser(user: AuthContext | null): AuthContext {
  if (!user) throw new UnauthorizedException('Session required');
  return user;
}
