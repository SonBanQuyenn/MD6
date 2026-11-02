import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { Role } from '@prisma/client';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ListProductsQueryDto } from './dto/list-products-query.dto';
import { CreateProductDto, UpdateProductDto } from './dto/product.dto';
import { ProductsService } from './products.service';

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  /** GET /api/products — danh sách có lọc + phân trang (công khai). */
  @Get()
  @Public()
  async list(
    @Query() query: ListProductsQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { data, cache } = await this.productsService.listWithCache(query);
    res.setHeader('X-Cache', cache); // HIT | MISS | BYPASS — để quan sát / đo hiệu năng
    return data;
  }

  /** GET /api/products/:id — chi tiết sản phẩm (công khai). */
  @Get(':id')
  @Public()
  async getOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { data, cache } = await this.productsService.getPublicWithCache(id);
    res.setHeader('X-Cache', cache);
    return data;
  }

  @Post()
  @Roles(Role.ADMIN)
  create(@Body() dto: CreateProductDto) {
    return this.productsService.create(dto);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.productsService.update(id, dto);
  }

  /** DELETE /api/products/:id — ngừng bán sản phẩm. */
  @Delete(':id')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  deactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.productsService.deactivate(id);
  }
}
