import { Module } from '@nestjs/common';
import {
  ProductDefinitionDto,
  ProductOrganizationDto,
  UpdateProductDefinitionDto,
} from './product-definition.dto.js';

/** DTO barrel so the package imports cleanly into the feature module. */
@Module({})
export class ProductsDtoModule {}

export { ProductDefinitionDto, ProductOrganizationDto, UpdateProductDefinitionDto };
