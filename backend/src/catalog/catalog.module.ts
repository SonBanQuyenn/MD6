import { Module } from '@nestjs/common';
import { BrandsController } from './brands/brands.controller';
import { BrandsRepository } from './brands/brands.repository';
import { BrandsService } from './brands/brands.service';
import { CategoriesController } from './categories/categories.controller';
import { CategoriesRepository } from './categories/categories.repository';
import { CategoriesService } from './categories/categories.service';
import { ProductsController } from './products/products.controller';
import { ProductsRepository } from './products/products.repository';
import { ProductsService } from './products/products.service';

/** Danh mục, thương hiệu và sản phẩm (yêu cầu F06.1). */
@Module({
  controllers: [CategoriesController, BrandsController, ProductsController],
  providers: [
    CategoriesService,
    CategoriesRepository,
    BrandsService,
    BrandsRepository,
    ProductsService,
    ProductsRepository,
  ],
  exports: [ProductsService, ProductsRepository],
})
export class CatalogModule {}
