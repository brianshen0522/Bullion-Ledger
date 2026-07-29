export interface ReferenceOption {
  /** Canonical value persisted by the API. */
  value: string;
  /** Primary user-facing label. */
  label: string;
  /** Additional names accepted by searchable selects. */
  aliases?: readonly string[];
  /** Optional secondary line shown beneath the label. */
  description?: string;
}

const COUNTRY_CODES = `
AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ
BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ
CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ
DE DJ DK DM DO DZ
EC EE EG EH ER ES ET
FI FJ FK FM FO FR
GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY
HK HM HN HR HT HU
ID IE IL IM IN IO IQ IR IS IT
JE JM JO JP
KE KG KH KI KM KN KP KR KW KY KZ
LA LB LC LI LK LR LS LT LU LV LY
MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ
NA NC NE NF NG NI NL NO NP NR NU NZ
OM
PA PE PF PG PH PK PL PM PN PR PS PT PW PY
QA
RE RO RS RU RW
SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ
TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ
UA UG UM US UY UZ
VA VC VE VG VI VN VU
WF WS
YE YT
ZA ZM ZW
`
  .trim()
  .split(/\s+/);

const CURRENCY_CODES = `
AED AFN ALL AMD ANG AOA ARS AUD AWG AZN
BAM BBD BDT BGN BHD BIF BMD BND BOB BRL BSD BTN BWP BYN BZD
CAD CDF CHF CLP CNY COP CRC CUP CVE CZK
DJF DKK DOP DZD
EGP ERN ETB EUR
FJD FKP
GBP GEL GHS GIP GMD GNF GTQ GYD
HKD HNL HTG HUF
IDR ILS INR IQD IRR ISK
JMD JOD JPY
KES KGS KHR KMF KPW KRW KWD KYD KZT
LAK LBP LKR LRD LSL LYD
MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MYR MZN
NAD NGN NIO NOK NPR NZD
OMR
PAB PEN PGK PHP PKR PLN PYG
QAR
RON RSD RUB RWF
SAR SBD SCR SDG SEK SGD SHP SLE SOS SRD SSP STN SVC SYP SZL
THB TJS TMT TND TOP TRY TTD TWD TZS
UAH UGX USD UYU UZS
VES VND VUV
WST
YER
ZAR ZMW ZWG
`
  .trim()
  .split(/\s+/);

const COUNTRY_COMMON_ALIASES: Readonly<Record<string, readonly string[]>> = {
  TW: ['台灣', '臺灣', '中華民國', 'ROC', 'Republic of China', 'Taiwan', 'TWN'],
  CH: ['瑞士', 'Swiss', 'Switzerland', 'Suisse', 'Schweiz', 'CHE'],
  US: ['美國', '美国', 'USA', 'United States', 'America', '美利堅', '美利坚', 'USA'],
  GB: ['英國', '英国', 'UK', 'United Kingdom', 'Britain', 'Great Britain', 'GBR'],
  CN: ['中國', '中国', 'PRC', 'Mainland China', '中國大陸', '中国大陆', '大陸', '大陆', 'CHN'],
  HK: ['香港', 'Hong Kong', 'HKG'],
  CA: ['加拿大', 'Canada', 'CAN'],
  AU: ['澳洲', '澳大利亞', '澳大利亚', 'Australia', 'AUS'],
  AT: ['奧地利', '奥地利', 'Austria', 'AUT'],
  SG: ['新加坡', 'Singapore', 'SGP'],
  JP: ['日本', 'Japan', 'JPN'],
  DE: ['德國', '德国', 'Germany', 'Deutschland', 'DEU'],
  ZA: ['南非', 'South Africa', 'RSA', 'ZAF'],
};

const CURRENCY_COMMON_ALIASES: Readonly<Record<string, readonly string[]>> = {
  TWD: ['台幣', '臺幣', '新台幣', '新臺幣', 'NTD', 'NT$', 'Taiwan dollar', 'New Taiwan dollar'],
  USD: ['美金', '美元', 'US dollar', 'United States dollar', 'Dollar', 'Buck'],
  CNY: ['人民幣', '人民币', 'RMB', 'Renminbi', 'Chinese yuan', 'Yuan'],
  HKD: ['港幣', '港币', 'Hong Kong dollar', 'HK dollar'],
  JPY: ['日圓', '日元', '円', 'Yen', 'Japanese yen'],
  EUR: ['歐元', '欧元', 'Euro'],
  GBP: ['英鎊', '英镑', 'Pound sterling', 'Sterling', 'British pound'],
  CHF: ['瑞士法郎', 'Swiss franc', 'Franc suisse'],
  AUD: ['澳幣', '澳元', 'Australian dollar'],
  CAD: ['加幣', '加元', 'Canadian dollar'],
  KRW: ['韓元', '韩元', '韓圓', '韩圆', 'Korean won', 'Won'],
  SGD: ['新幣', '星幣', 'Singapore dollar'],
  NZD: ['紐幣', '紐元', '新西蘭元', 'New Zealand dollar'],
  MYR: ['馬幣', '馬來西亞令吉', '令吉', 'Ringgit'],
  THB: ['泰幣', '泰銖', '泰铢', 'Baht'],
  AED: ['阿聯酋迪拉姆', '迪拉姆', 'UAE dirham'],
};

const PREFERRED_COUNTRIES = [
  'TW',
  'CH',
  'AU',
  'CA',
  'US',
  'GB',
  'AT',
  'ZA',
  'CN',
  'JP',
  'DE',
  'SG',
  'HK',
] as const;

const PREFERRED_CURRENCIES = [
  'TWD',
  'USD',
  'CNY',
  'HKD',
  'JPY',
  'EUR',
  'GBP',
  'CHF',
  'AUD',
  'CAD',
  'SGD',
  'KRW',
  'NZD',
  'MYR',
  'THB',
  'AED',
] as const;

function displayNames(locale: string, type: 'region' | 'currency'): Intl.DisplayNames | null {
  try {
    return new Intl.DisplayNames([locale], { type, fallback: 'code' });
  } catch {
    return null;
  }
}

function localizedName(names: Intl.DisplayNames | null, code: string): string {
  try {
    return names?.of(code) ?? code;
  } catch {
    return code;
  }
}

function uniqueAliases(values: readonly (string | undefined)[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function prioritizeOptions(
  options: ReferenceOption[],
  preferredValues: readonly string[],
): ReferenceOption[] {
  const preferredRank = new Map(preferredValues.map((value, index) => [value, index]));
  return options.sort((left, right) => {
    const leftRank = preferredRank.get(left.value);
    const rightRank = preferredRank.get(right.value);
    if (leftRank !== undefined || rightRank !== undefined) {
      return (leftRank ?? Number.MAX_SAFE_INTEGER) - (rightRank ?? Number.MAX_SAFE_INTEGER);
    }
    return left.label.localeCompare(right.label, 'zh-TW');
  });
}

function makeCountryOptions(): ReferenceOption[] {
  const traditionalChinese = displayNames('zh-TW', 'region');
  const english = displayNames('en', 'region');
  return prioritizeOptions(
    COUNTRY_CODES.map((code) => {
      const zhName = localizedName(traditionalChinese, code);
      const enName = localizedName(english, code);
      return {
        value: code,
        label: `${code} — ${zhName}`,
        aliases: uniqueAliases([code, zhName, enName, ...(COUNTRY_COMMON_ALIASES[code] ?? [])]),
        description: enName !== zhName && enName !== code ? enName : undefined,
      };
    }),
    PREFERRED_COUNTRIES,
  );
}

function makeCurrencyOptions(): ReferenceOption[] {
  const traditionalChinese = displayNames('zh-TW', 'currency');
  const english = displayNames('en', 'currency');
  return prioritizeOptions(
    CURRENCY_CODES.map((code) => {
      const zhName = localizedName(traditionalChinese, code);
      const enName = localizedName(english, code);
      return {
        value: code,
        label: `${code} — ${zhName}`,
        aliases: uniqueAliases([code, zhName, enName, ...(CURRENCY_COMMON_ALIASES[code] ?? [])]),
        description: enName !== zhName && enName !== code ? enName : undefined,
      };
    }),
    PREFERRED_CURRENCIES,
  );
}

/** ISO 3166-1 alpha-2 regions with zh-TW and English names generated by the runtime. */
export const COUNTRY_OPTIONS: readonly ReferenceOption[] = makeCountryOptions();

/** Active ISO 4217 fiat currencies, displayed by canonical alpha-3 code. */
export const CURRENCY_OPTIONS: readonly ReferenceOption[] = makeCurrencyOptions();

/** Acquisition packaging states. Values remain human-readable in inventory and exports. */
export const PACKAGING_OPTIONS: readonly ReferenceOption[] = [
  { value: '原廠密封', label: '原廠密封／原封', aliases: ['原封', '未拆封', 'factory sealed'] },
  { value: '原廠卡裝', label: '原廠卡裝', aliases: ['卡裝', 'assay card', 'blister card'] },
  { value: '膠囊', label: '膠囊', aliases: ['硬殼', 'coin capsule', 'capsule'] },
  { value: '盒裝', label: '盒裝', aliases: ['原廠盒', '展示盒', 'box'] },
  { value: '塑膠封套', label: '塑膠封套', aliases: ['封套', 'soft flip', 'plastic sleeve'] },
  { value: '裸條／裸幣', label: '裸條／裸幣', aliases: ['裸條', '裸幣', '裸裝', 'loose'] },
  { value: '重新包裝', label: '重新包裝', aliases: ['二次包裝', 'repacked'] },
  { value: '包裝破損', label: '包裝破損', aliases: ['破損', 'damaged packaging'] },
  { value: '其他', label: '其他' },
];

/**
 * Keeps an existing value selectable even when it predates the current catalog.
 * This prevents opening and saving an edit form from silently clearing legacy data.
 */
export function withCurrentReferenceOption(
  options: readonly ReferenceOption[],
  currentValue: string,
): readonly ReferenceOption[] {
  if (!currentValue || options.some(({ value }) => value === currentValue)) return options;
  return [
    {
      value: currentValue,
      label: currentValue,
      aliases: [currentValue],
      description: '既有資料',
    },
    ...options,
  ];
}

/** NFKC and punctuation-tolerant normalization for touch keyboard and alias searches. */
export function normalizeReferenceSearch(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function matchRank(option: ReferenceOption, normalizedQuery: string): number | null {
  if (!normalizedQuery) return 0;
  const candidates = [option.value, option.label, ...(option.aliases ?? [])].map(
    normalizeReferenceSearch,
  );
  const tokens = normalizedQuery.split(' ');
  const haystack = candidates.join(' ');
  const compactQuery = normalizedQuery.replace(/\s/g, '');
  const punctuationSeparatedInitials =
    tokens.length > 1 && tokens.every((token) => token.length === 1);
  const matches = punctuationSeparatedInitials
    ? candidates.some((candidate) => candidate.replace(/\s/g, '').includes(compactQuery))
    : tokens.every((token) => haystack.includes(token));
  if (!matches) return null;
  if (normalizeReferenceSearch(option.value) === normalizedQuery) return 0;
  if (candidates.some((candidate) => candidate === normalizedQuery)) return 1;
  if (
    punctuationSeparatedInitials &&
    candidates.some((candidate) => candidate.replace(/\s/g, '') === compactQuery)
  )
    return 1;
  if (candidates.some((candidate) => candidate.startsWith(normalizedQuery))) return 2;
  return 3;
}

/** Filters and ranks reference options without changing canonical values. */
export function filterReferenceOptions(
  options: readonly ReferenceOption[],
  query: string,
): ReferenceOption[] {
  const normalizedQuery = normalizeReferenceSearch(query);
  if (!normalizedQuery) return [...options];
  return options
    .map((option, index) => ({ option, index, rank: matchRank(option, normalizedQuery) }))
    .filter(
      (entry): entry is { option: ReferenceOption; index: number; rank: number } =>
        entry.rank !== null,
    )
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map(({ option }) => option);
}
