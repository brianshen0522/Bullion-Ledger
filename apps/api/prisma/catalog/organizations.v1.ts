/**
 * Curated organization catalog v1.
 *
 * This is intentionally data-only, deterministic, and independent of the
 * generated Prisma client so it can be counted and reviewed without a
 * database. Canonical names are also emitted as OFFICIAL aliases by the
 * flattened ORGANIZATION_ALIASES_V1 export below.
 */
export const ORGANIZATION_CATALOG_VERSION = '2026-07-28.v1' as const;

export type OrganizationRoleFixture =
  'BRAND' | 'REFINER' | 'MINT' | 'MANUFACTURER' | 'ISSUER' | 'ASSAYER';

export type OrganizationAliasKindFixture =
  'OFFICIAL' | 'FORMER_NAME' | 'TRADE_NAME' | 'ACRONYM' | 'LOCALIZED' | 'SEARCH_ONLY';

export interface OrganizationAliasFixture {
  name: string;
  kind: OrganizationAliasKindFixture;
  locale?: string;
  validFrom?: string;
  validTo?: string;
}

export interface OrganizationFixture {
  seedKey: string;
  canonicalName: string;
  countryCode?: string;
  capabilities: readonly OrganizationRoleFixture[];
  aliases: readonly OrganizationAliasFixture[];
}

const a = (
  name: string,
  kind: OrganizationAliasKindFixture = 'SEARCH_ONLY',
  locale?: string,
): OrganizationAliasFixture => ({ name, kind, ...(locale ? { locale } : {}) });

const org = (
  seedKey: string,
  canonicalName: string,
  countryCode: string | undefined,
  capabilities: readonly OrganizationRoleFixture[],
  aliases: readonly OrganizationAliasFixture[],
): OrganizationFixture => ({ seedKey, canonicalName, countryCode, capabilities, aliases });

export const ORGANIZATIONS_V1 = [
  // Switzerland and European refiners / bullion manufacturers.
  org(
    'ch-mks-pamp',
    'MKS PAMP SA',
    'CH',
    ['BRAND', 'REFINER', 'MANUFACTURER'],
    [a('PAMP', 'TRADE_NAME'), a('PAMP Suisse', 'TRADE_NAME')],
  ),
  org(
    'ch-argor-heraeus',
    'Argor-Heraeus SA',
    'CH',
    ['BRAND', 'REFINER', 'MANUFACTURER'],
    [a('Argor Heraeus', 'SEARCH_ONLY'), a('Argor', 'TRADE_NAME')],
  ),
  org(
    'ch-valcambi',
    'Valcambi SA',
    'CH',
    ['BRAND', 'REFINER', 'MANUFACTURER'],
    [a('Valcambi Suisse', 'TRADE_NAME')],
  ),
  org(
    'ch-metalor',
    'Metalor Technologies SA',
    'CH',
    ['BRAND', 'REFINER', 'ASSAYER'],
    [a('Metalor', 'TRADE_NAME')],
  ),
  org(
    'de-heraeus',
    'Heraeus Precious Metals',
    'DE',
    ['BRAND', 'REFINER', 'MANUFACTURER'],
    [a('Heraeus', 'TRADE_NAME')],
  ),
  org(
    'de-c-hafner',
    'C. Hafner GmbH + Co. KG',
    'DE',
    ['BRAND', 'REFINER', 'MANUFACTURER'],
    [a('C Hafner', 'SEARCH_ONLY')],
  ),
  org(
    'de-agosi',
    'Allgemeine Gold- und Silberscheideanstalt AG',
    'DE',
    ['REFINER', 'ASSAYER'],
    [a('Agosi', 'ACRONYM')],
  ),
  org(
    'de-heimerle-meule',
    'Heimerle + Meule GmbH',
    'DE',
    ['BRAND', 'REFINER', 'MANUFACTURER'],
    [a('Heimerle & Meule', 'SEARCH_ONLY')],
  ),
  org(
    'be-umicore',
    'Umicore SA',
    'BE',
    ['BRAND', 'REFINER', 'MANUFACTURER'],
    [a('Umicore Precious Metals', 'TRADE_NAME')],
  ),
  org(
    'de-geiger',
    'Geiger Edelmetalle AG',
    'DE',
    ['BRAND', 'MANUFACTURER'],
    [a('Geiger', 'TRADE_NAME')],
  ),
  org(
    'de-leipziger',
    'Leipziger Edelmetallverarbeitung GmbH',
    'DE',
    ['REFINER', 'MANUFACTURER'],
    [a('LEV', 'ACRONYM')],
  ),
  org(
    'de-degussa-historical',
    'Degussa AG',
    'DE',
    ['BRAND', 'REFINER'],
    [a('Deutsche Gold- und Silber-Scheideanstalt', 'FORMER_NAME', 'de')],
  ),
  org(
    'uk-johnson-matthey',
    'Johnson Matthey plc',
    'GB',
    ['BRAND', 'REFINER', 'ASSAYER'],
    [a('JM', 'ACRONYM')],
  ),
  org(
    'us-engelhard-historical',
    'Engelhard Corporation',
    'US',
    ['BRAND', 'REFINER'],
    [a('Engelhard', 'TRADE_NAME')],
  ),

  // Asia-Pacific, Middle East, Africa, and Americas refiners.
  org(
    'za-rand-refinery',
    'Rand Refinery Limited',
    'ZA',
    ['BRAND', 'REFINER', 'ASSAYER'],
    [a('Rand Refinery', 'TRADE_NAME')],
  ),
  org(
    'au-abc-refinery',
    'ABC Refinery',
    'AU',
    ['BRAND', 'REFINER', 'ASSAYER'],
    [a('Australian Bullion Company Refinery', 'SEARCH_ONLY')],
  ),
  org(
    'jp-asahi-refining',
    'Asahi Refining',
    'JP',
    ['BRAND', 'REFINER', 'ASSAYER'],
    [a('Asahi', 'TRADE_NAME')],
  ),
  org(
    'jp-tanaka',
    'Tanaka Kikinzoku Kogyo K.K.',
    'JP',
    ['BRAND', 'REFINER', 'MANUFACTURER'],
    [a('Tanaka Precious Metals', 'TRADE_NAME'), a('田中貴金属工業', 'LOCALIZED', 'ja')],
  ),
  org(
    'jp-tokuriki',
    'Tokuriki Honten Co., Ltd.',
    'JP',
    ['BRAND', 'REFINER', 'MANUFACTURER'],
    [a('Tokuriki', 'TRADE_NAME'), a('徳力本店', 'LOCALIZED', 'ja')],
  ),
  org(
    'jp-mitsubishi-materials',
    'Mitsubishi Materials Corporation',
    'JP',
    ['BRAND', 'REFINER'],
    [a('Mitsubishi Materials', 'TRADE_NAME')],
  ),
  org(
    'jp-sumitomo-metal-mining',
    'Sumitomo Metal Mining Co., Ltd.',
    'JP',
    ['BRAND', 'REFINER'],
    [a('SMM', 'ACRONYM')],
  ),
  org(
    'jp-ishifuku',
    'Ishifuku Metal Industry Co., Ltd.',
    'JP',
    ['REFINER', 'MANUFACTURER'],
    [a('Ishifuku', 'TRADE_NAME')],
  ),
  org(
    'jp-matsuda-sangyo',
    'Matsuda Sangyo Co., Ltd.',
    'JP',
    ['REFINER'],
    [a('Matsuda Sangyo', 'TRADE_NAME')],
  ),
  org('kr-ls-mnms', 'LS MnM Inc.', 'KR', ['REFINER'], [a('LS-Nikko Copper', 'FORMER_NAME')]),
  org(
    'kr-korea-zinc',
    'Korea Zinc Company, Ltd.',
    'KR',
    ['REFINER'],
    [a('Korea Zinc', 'TRADE_NAME')],
  ),
  org(
    'tr-istanbul-gold-refinery',
    'Istanbul Gold Refinery',
    'TR',
    ['BRAND', 'REFINER', 'MANUFACTURER'],
    [a('IGR', 'ACRONYM')],
  ),
  org(
    'tr-nadir-metal',
    'Nadir Metal Rafineri A.Ş.',
    'TR',
    ['BRAND', 'REFINER'],
    [a('Nadir Metal', 'TRADE_NAME')],
  ),
  org(
    'ae-emirates-gold',
    'Emirates Gold DMCC',
    'AE',
    ['BRAND', 'REFINER', 'MANUFACTURER'],
    [a('Emirates Gold', 'TRADE_NAME')],
  ),
  org(
    'ae-al-etihad-gold',
    'Al Etihad Gold Refinery DMCC',
    'AE',
    ['BRAND', 'REFINER'],
    [a('Al Etihad Gold', 'TRADE_NAME')],
  ),
  org(
    'ae-sam-precious-metals',
    'SAM Precious Metals',
    'AE',
    ['BRAND', 'REFINER'],
    [a('SAM', 'ACRONYM')],
  ),
  org(
    'in-mmtc-pamp',
    'MMTC-PAMP India Private Limited',
    'IN',
    ['BRAND', 'REFINER', 'MANUFACTURER'],
    [a('MMTC PAMP', 'TRADE_NAME')],
  ),
  org(
    'in-bangalore-refinery',
    'Bangalore Refinery Private Limited',
    'IN',
    ['BRAND', 'REFINER'],
    [a('Bangalore Refinery', 'TRADE_NAME')],
  ),
  org(
    'ca-asahi-refining-canada',
    'Asahi Refining Canada Limited',
    'CA',
    ['REFINER', 'ASSAYER'],
    [a('Johnson Matthey Canada', 'FORMER_NAME')],
  ),
  org(
    'us-asahi-refining-usa',
    'Asahi Refining USA Inc.',
    'US',
    ['REFINER', 'ASSAYER'],
    [a('Asahi USA', 'TRADE_NAME')],
  ),
  org(
    'us-kennecott',
    'Kennecott Utah Copper LLC',
    'US',
    ['REFINER'],
    [a('Kennecott', 'TRADE_NAME')],
  ),
  org(
    'mx-penoles',
    'Met-Mex Peñoles, S.A. de C.V.',
    'MX',
    ['BRAND', 'REFINER'],
    [a('Met-Mex Penoles', 'SEARCH_ONLY')],
  ),
  org('kz-kazzinc', 'Kazzinc Ltd.', 'KZ', ['BRAND', 'REFINER'], [a('Kazzinc', 'TRADE_NAME')]),
  org(
    'uz-navoi',
    'Navoi Mining and Metallurgical Company',
    'UZ',
    ['REFINER'],
    [a('NMMC', 'ACRONYM')],
  ),

  // Sovereign and private mints.
  org(
    'gb-royal-mint',
    'The Royal Mint',
    'GB',
    ['BRAND', 'MINT', 'MANUFACTURER', 'ISSUER'],
    [a('Royal Mint', 'TRADE_NAME')],
  ),
  org(
    'au-perth-mint',
    'The Perth Mint',
    'AU',
    ['BRAND', 'REFINER', 'MINT', 'MANUFACTURER', 'ISSUER'],
    [a('Perth Mint', 'TRADE_NAME')],
  ),
  org(
    'ca-royal-canadian-mint',
    'Royal Canadian Mint',
    'CA',
    ['BRAND', 'REFINER', 'MINT', 'MANUFACTURER', 'ISSUER'],
    [a('RCM', 'ACRONYM'), a('Monnaie royale canadienne', 'LOCALIZED', 'fr-CA')],
  ),
  org(
    'at-austrian-mint',
    'Austrian Mint',
    'AT',
    ['BRAND', 'MINT', 'MANUFACTURER', 'ISSUER'],
    [a('Münze Österreich', 'LOCALIZED', 'de-AT')],
  ),
  org(
    'us-united-states-mint',
    'United States Mint',
    'US',
    ['BRAND', 'MINT', 'MANUFACTURER', 'ISSUER'],
    [a('US Mint', 'ACRONYM')],
  ),
  org(
    'jp-japan-mint',
    'Japan Mint',
    'JP',
    ['BRAND', 'MINT', 'MANUFACTURER', 'ISSUER'],
    [a('造幣局', 'LOCALIZED', 'ja')],
  ),
  org(
    'cn-china-gold-coin',
    'China Gold Coin Group Co., Ltd.',
    'CN',
    ['BRAND', 'MINT', 'MANUFACTURER'],
    [a('China Gold Coin', 'TRADE_NAME'), a('中國金幣集團', 'LOCALIZED', 'zh-Hant')],
  ),
  org(
    'tw-central-mint',
    'Central Mint of Taiwan',
    'TW',
    ['BRAND', 'MINT', 'MANUFACTURER', 'ISSUER'],
    [a('中央造幣廠', 'LOCALIZED', 'zh-Hant-TW'), a('Central Mint', 'TRADE_NAME')],
  ),
  org(
    'fr-monnaie-de-paris',
    'Monnaie de Paris',
    'FR',
    ['BRAND', 'MINT', 'MANUFACTURER', 'ISSUER'],
    [a('Paris Mint', 'SEARCH_ONLY')],
  ),
  org(
    'ch-swissmint',
    'Swissmint',
    'CH',
    ['BRAND', 'MINT', 'MANUFACTURER', 'ISSUER'],
    [a('Federal Mint Swissmint', 'OFFICIAL')],
  ),
  org(
    'nl-royal-dutch-mint',
    'Royal Dutch Mint',
    'NL',
    ['BRAND', 'MINT', 'MANUFACTURER'],
    [a('Koninklijke Nederlandse Munt', 'LOCALIZED', 'nl')],
  ),
  org(
    'fi-mint-of-finland',
    'Mint of Finland Ltd.',
    'FI',
    ['BRAND', 'MINT', 'MANUFACTURER'],
    [a('Suomen Rahapaja', 'LOCALIZED', 'fi')],
  ),
  org(
    'no-mint-of-norway',
    'Mint of Norway',
    'NO',
    ['BRAND', 'MINT', 'MANUFACTURER'],
    [a('Det Norske Myntverket', 'LOCALIZED', 'no')],
  ),
  org(
    'pl-mint-of-poland',
    'Mint of Poland',
    'PL',
    ['BRAND', 'MINT', 'MANUFACTURER'],
    [a('Mennica Polska', 'LOCALIZED', 'pl')],
  ),
  org(
    'cz-czech-mint',
    'Czech Mint',
    'CZ',
    ['BRAND', 'MINT', 'MANUFACTURER'],
    [a('Česká mincovna', 'LOCALIZED', 'cs')],
  ),
  org(
    'sk-kremnica-mint',
    'Kremnica Mint',
    'SK',
    ['BRAND', 'MINT', 'MANUFACTURER'],
    [a('Mincovňa Kremnica', 'LOCALIZED', 'sk')],
  ),
  org(
    'it-ipzs',
    'Istituto Poligrafico e Zecca dello Stato',
    'IT',
    ['MINT', 'MANUFACTURER', 'ISSUER'],
    [a('Italian State Mint', 'SEARCH_ONLY'), a('IPZS', 'ACRONYM')],
  ),
  org(
    'es-fnmt',
    'Fábrica Nacional de Moneda y Timbre',
    'ES',
    ['MINT', 'MANUFACTURER', 'ISSUER'],
    [a('FNMT', 'ACRONYM'), a('Royal Mint of Spain', 'SEARCH_ONLY')],
  ),
  org(
    'pt-incm',
    'Imprensa Nacional-Casa da Moeda',
    'PT',
    ['MINT', 'MANUFACTURER', 'ISSUER'],
    [a('INCM', 'ACRONYM')],
  ),
  org(
    'za-south-african-mint',
    'South African Mint',
    'ZA',
    ['BRAND', 'MINT', 'MANUFACTURER', 'ISSUER'],
    [a('SA Mint', 'ACRONYM')],
  ),
  org(
    'nz-new-zealand-mint',
    'New Zealand Mint',
    'NZ',
    ['BRAND', 'MINT', 'MANUFACTURER'],
    [a('NZ Mint', 'ACRONYM')],
  ),
  org(
    'us-scottsdale-mint',
    'Scottsdale Mint',
    'US',
    ['BRAND', 'MINT', 'MANUFACTURER'],
    [a('Scottsdale Silver', 'TRADE_NAME')],
  ),
  org(
    'us-sunshine-minting',
    'Sunshine Minting, Inc.',
    'US',
    ['BRAND', 'MINT', 'MANUFACTURER'],
    [a('Sunshine Mint', 'TRADE_NAME')],
  ),
  org(
    'de-germania-mint',
    'Germania Mint',
    'DE',
    ['BRAND', 'MINT', 'MANUFACTURER'],
    [a('Germania', 'TRADE_NAME')],
  ),

  // Financial institutions commonly found as bullion brands or issuers.
  org(
    'ch-ubs',
    'UBS AG',
    'CH',
    ['BRAND', 'ISSUER'],
    [a('UBS', 'ACRONYM'), a('Union Bank of Switzerland', 'FORMER_NAME')],
  ),
  org(
    'ch-credit-suisse',
    'Credit Suisse AG',
    'CH',
    ['BRAND', 'ISSUER'],
    [a('Credit Suisse', 'TRADE_NAME'), a('CS', 'ACRONYM')],
  ),
  org(
    'ch-swiss-bank-corp-historical',
    'Swiss Bank Corporation',
    'CH',
    ['BRAND', 'ISSUER'],
    [a('SBC', 'ACRONYM'), a('Schweizerischer Bankverein', 'FORMER_NAME', 'de')],
  ),
  org(
    'tw-bank-of-taiwan',
    'Bank of Taiwan',
    'TW',
    ['BRAND', 'ISSUER'],
    [
      a('臺灣銀行', 'LOCALIZED', 'zh-Hant-TW'),
      a('台灣銀行', 'SEARCH_ONLY', 'zh-Hant-TW'),
      a('BOT', 'ACRONYM'),
    ],
  ),
  org(
    'tw-first-commercial-bank',
    'First Commercial Bank',
    'TW',
    ['BRAND', 'ISSUER'],
    [
      a('第一商業銀行', 'LOCALIZED', 'zh-Hant-TW'),
      a('第一銀行', 'TRADE_NAME', 'zh-Hant-TW'),
      a('First Bank', 'TRADE_NAME'),
    ],
  ),
  org(
    'tw-mega-bank',
    'Mega International Commercial Bank',
    'TW',
    ['BRAND', 'ISSUER'],
    [
      a('兆豐國際商業銀行', 'LOCALIZED', 'zh-Hant-TW'),
      a('兆豐銀行', 'TRADE_NAME', 'zh-Hant-TW'),
      a('Mega Bank', 'TRADE_NAME'),
    ],
  ),
  org(
    'tw-taiwan-cooperative-bank',
    'Taiwan Cooperative Bank',
    'TW',
    ['BRAND', 'ISSUER'],
    [
      a('合作金庫商業銀行', 'LOCALIZED', 'zh-Hant-TW'),
      a('合作金庫', 'TRADE_NAME', 'zh-Hant-TW'),
      a('TCB', 'ACRONYM'),
    ],
  ),
  org(
    'tw-land-bank',
    'Land Bank of Taiwan',
    'TW',
    ['BRAND', 'ISSUER'],
    [a('臺灣土地銀行', 'LOCALIZED', 'zh-Hant-TW'), a('土地銀行', 'TRADE_NAME', 'zh-Hant-TW')],
  ),
  org(
    'tw-hua-nan-bank',
    'Hua Nan Commercial Bank',
    'TW',
    ['BRAND', 'ISSUER'],
    [a('華南商業銀行', 'LOCALIZED', 'zh-Hant-TW'), a('華南銀行', 'TRADE_NAME', 'zh-Hant-TW')],
  ),
  org(
    'tw-chang-hwa-bank',
    'Chang Hwa Commercial Bank',
    'TW',
    ['BRAND', 'ISSUER'],
    [a('彰化商業銀行', 'LOCALIZED', 'zh-Hant-TW'), a('彰化銀行', 'TRADE_NAME', 'zh-Hant-TW')],
  ),
  org(
    'tw-cathay-united-bank',
    'Cathay United Bank',
    'TW',
    ['BRAND', 'ISSUER'],
    [a('國泰世華商業銀行', 'LOCALIZED', 'zh-Hant-TW'), a('國泰世華', 'TRADE_NAME', 'zh-Hant-TW')],
  ),
  org(
    'tw-esun-bank',
    'E.SUN Commercial Bank',
    'TW',
    ['BRAND', 'ISSUER'],
    [a('玉山商業銀行', 'LOCALIZED', 'zh-Hant-TW'), a('玉山銀行', 'TRADE_NAME', 'zh-Hant-TW')],
  ),
  org(
    'tw-ctbc-bank',
    'CTBC Bank',
    'TW',
    ['BRAND', 'ISSUER'],
    [a('中國信託商業銀行', 'LOCALIZED', 'zh-Hant-TW'), a('中國信託', 'TRADE_NAME', 'zh-Hant-TW')],
  ),
  org(
    'gb-hsbc',
    'HSBC Holdings plc',
    'GB',
    ['BRAND', 'ISSUER'],
    [a('HSBC', 'ACRONYM'), a('Hongkong and Shanghai Banking Corporation', 'FORMER_NAME')],
  ),
  org(
    'gb-standard-chartered',
    'Standard Chartered plc',
    'GB',
    ['BRAND', 'ISSUER'],
    [a('Standard Chartered Bank', 'TRADE_NAME')],
  ),
  org(
    'de-deutsche-bank',
    'Deutsche Bank AG',
    'DE',
    ['BRAND', 'ISSUER'],
    [a('Deutsche Bank', 'TRADE_NAME')],
  ),
  org(
    'de-commerzbank',
    'Commerzbank AG',
    'DE',
    ['BRAND', 'ISSUER'],
    [a('Commerzbank', 'TRADE_NAME')],
  ),
  org(
    'fr-societe-generale',
    'Société Générale S.A.',
    'FR',
    ['BRAND', 'ISSUER'],
    [a('Societe Generale', 'SEARCH_ONLY'), a('SG', 'ACRONYM')],
  ),
  org(
    'fr-bnp-paribas',
    'BNP Paribas S.A.',
    'FR',
    ['BRAND', 'ISSUER'],
    [a('BNP Paribas', 'TRADE_NAME')],
  ),
  org(
    'us-jpmorgan',
    'JPMorgan Chase & Co.',
    'US',
    ['BRAND', 'ISSUER'],
    [a('J.P. Morgan', 'TRADE_NAME'), a('JPMorgan', 'SEARCH_ONLY')],
  ),
  org(
    'ca-scotiabank',
    'The Bank of Nova Scotia',
    'CA',
    ['BRAND', 'ISSUER'],
    [a('Scotiabank', 'TRADE_NAME')],
  ),
  org('ca-rbc', 'Royal Bank of Canada', 'CA', ['BRAND', 'ISSUER'], [a('RBC', 'ACRONYM')]),
  org(
    'au-anz',
    'Australia and New Zealand Banking Group Limited',
    'AU',
    ['BRAND', 'ISSUER'],
    [a('ANZ', 'ACRONYM')],
  ),
  org(
    'cn-bank-of-china',
    'Bank of China Limited',
    'CN',
    ['BRAND', 'ISSUER'],
    [a('中國銀行', 'LOCALIZED', 'zh-Hans'), a('BOC', 'ACRONYM')],
  ),
  org(
    'cn-icbc',
    'Industrial and Commercial Bank of China Limited',
    'CN',
    ['BRAND', 'ISSUER'],
    [a('中國工商銀行', 'LOCALIZED', 'zh-Hans'), a('ICBC', 'ACRONYM')],
  ),
  org('sg-dbs', 'DBS Bank Ltd.', 'SG', ['BRAND', 'ISSUER'], [a('DBS', 'ACRONYM')]),
  org(
    'sg-ocbc',
    'Oversea-Chinese Banking Corporation Limited',
    'SG',
    ['BRAND', 'ISSUER'],
    [a('OCBC', 'ACRONYM')],
  ),
  org('sg-uob', 'United Overseas Bank Limited', 'SG', ['BRAND', 'ISSUER'], [a('UOB', 'ACRONYM')]),
  org(
    'uk-rothschild-historical',
    'N M Rothschild & Sons Limited',
    'GB',
    ['BRAND', 'ISSUER'],
    [a('N M Rothschild', 'TRADE_NAME'), a('Rothschild', 'SEARCH_ONLY')],
  ),
] as const satisfies readonly OrganizationFixture[];

export interface SeededOrganizationAlias extends OrganizationAliasFixture {
  seedKey: string;
  organizationSeedKey: string;
}

export const ORGANIZATION_ALIASES_V1: readonly SeededOrganizationAlias[] = ORGANIZATIONS_V1.flatMap(
  (organization) => [
    {
      seedKey: `${organization.seedKey}:official`,
      organizationSeedKey: organization.seedKey,
      name: organization.canonicalName,
      kind: 'OFFICIAL' as const,
    },
    ...organization.aliases.map((alias, index) => ({
      seedKey: `${organization.seedKey}:alias:${index + 1}`,
      organizationSeedKey: organization.seedKey,
      ...alias,
    })),
  ],
);
