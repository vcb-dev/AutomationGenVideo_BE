import { HttpException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { AxiosError } from 'axios';
import { catchError, firstValueFrom } from 'rxjs';
import { resolveOmsApiKey, resolveOmsApiUrl } from '../../common/config/oms-api-url';
import { QueryOmsProductDto } from './dto/oms-integration.dto';
import { OmsProductDetail, OmsProductListResponse, OmsProductVariant } from './oms-integration.types';

@Injectable()
export class OmsIntegrationService {
  private readonly logger = new Logger(OmsIntegrationService.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.baseUrl = resolveOmsApiUrl(this.configService);
    this.apiKey = resolveOmsApiKey(this.configService);
  }

  private headers() {
    return { 'X-API-Key': this.apiKey };
  }

  async listProducts(query: QueryOmsProductDto): Promise<OmsProductListResponse> {
    const url = `${this.baseUrl}/products`;
    const { data } = await firstValueFrom(
      this.httpService
        .get<OmsProductListResponse>(url, {
          headers: this.headers(),
          timeout: 15000,
          params: {
            q: query.q,
            page: query.page,
            page_size: query.page_size,
            is_published: query.is_published,
            category_id: query.category_id,
          },
        })
        .pipe(
          catchError((error: AxiosError) => {
            this.logger.error(`OMS listProducts lỗi: ${error.message}`, error.response?.data as any);
            throw new HttpException(
              (error.response?.data as any) || 'Không thể kết nối OMS',
              error.response?.status || HttpStatus.BAD_GATEWAY,
            );
          }),
        ),
    );
    return data;
  }

  async getProductDetail(omsProductId: string): Promise<OmsProductDetail> {
    const url = `${this.baseUrl}/products/${omsProductId}`;
    const { data } = await firstValueFrom(
      this.httpService
        .get<{ data: OmsProductDetail }>(url, { headers: this.headers(), timeout: 15000 })
        .pipe(
          catchError((error: AxiosError) => {
            if (error.response?.status === 404) {
              throw new NotFoundException(`Không tìm thấy sản phẩm OMS "${omsProductId}"`);
            }
            this.logger.error(`OMS getProductDetail lỗi: ${error.message}`, error.response?.data as any);
            throw new HttpException(
              (error.response?.data as any) || 'Không thể kết nối OMS',
              error.response?.status || HttpStatus.BAD_GATEWAY,
            );
          }),
        ),
    );
    return data.data;
  }

  /** Lấy đúng 1 variant (SKU thật) trong chi tiết product — dùng khi materialize TeamProduct/EditorProduct. */
  async getProductVariant(omsProductId: string, omsVariantId: string): Promise<{ product: OmsProductDetail; variant: OmsProductVariant }> {
    const product = await this.getProductDetail(omsProductId);
    const variant = product.variants.find((v) => v.id === omsVariantId);
    if (!variant) {
      throw new NotFoundException(`Không tìm thấy biến thể "${omsVariantId}" trong sản phẩm OMS "${omsProductId}"`);
    }
    return { product, variant };
  }
}
