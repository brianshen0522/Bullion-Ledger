import { Module } from '@nestjs/common';

import { PriceHttpClient } from './http-client.js';
import { GoldApiProvider } from './providers/gold-api.provider.js';
import { ExchangeRateApiProvider } from './providers/exchangerate-api.provider.js';
import { CurrencyApiProvider } from './providers/currency-api.provider.js';
import { PriceProviderRegistry } from './price-provider.registry.js';

/**
 * Market data acquisition boundary (PRD §12.1). Nothing outside this module
 * talks to a third-party price API directly, so swapping or adding a provider
 * never reaches into valuation or persistence code.
 */
@Module({
  providers: [
    PriceHttpClient,
    GoldApiProvider,
    ExchangeRateApiProvider,
    CurrencyApiProvider,
    PriceProviderRegistry,
  ],
  exports: [PriceProviderRegistry],
})
export class PriceProvidersModule {}
