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
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CreateTaxonomyDto, UpdateTaxonomyDto } from '../dto/taxonomy.dto';
import { BrandsService } from './brands.service';

@Controller('brands')
export class BrandsController {
  constructor(private readonly brandsService: BrandsService) {}

  /** GET /api/brands — công khai. */
  @Get()
  @Public()
  list() {
    return this.brandsService.list();
  }

  @Post()
  @Roles(Role.ADMIN)
  create(@Body() dto: CreateTaxonomyDto) {
    return this.brandsService.create(dto);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTaxonomyDto,
  ) {
    return this.brandsService.update(id, dto);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.brandsService.remove(id);
  }
}
