import { Body, Controller, Get, Post, Query } from '@nestjs/common';

import { AuthContext, CurrentUser } from '../common/decorators/current-user.decorator.js';
import {
  CreateOrganizationDto,
  OrganizationSearchQueryDto,
  type OrganizationSearchResultDto,
} from './dto/create-organization.dto.js';
import { OrganizationsService } from './organizations.service.js';

@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Get()
  search(@Query() query: OrganizationSearchQueryDto): Promise<OrganizationSearchResultDto[]> {
    return this.organizations.search(query);
  }

  @Post()
  create(@Body() dto: CreateOrganizationDto, @CurrentUser() user: AuthContext | null) {
    return this.organizations.create(dto, user?.userId);
  }
}
