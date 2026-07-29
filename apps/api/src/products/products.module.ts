import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller.js';
import { ProductsService } from './products.service.js';
import { ProductsDtoModule } from './dto/products-dto.module.js';
import { MetalsModule } from '../metals/metals.module.js';

@Module({
  imports: [ProductsDtoModule, MetalsModule],
  controllers: [ProductsController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
