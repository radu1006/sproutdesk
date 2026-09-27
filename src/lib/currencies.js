'use strict';

/**
 * The currencies an administrator can choose from.
 *
 * One list, used in three places: it validates `currency` in
 * `PATCH /api/settings`, it is sent to the browser as the choices of the
 * currency field (`GET /api/settings`) and it fills the currency picker on the
 * billing screen. Every entry is a real ISO 4217 currency, which is also what
 * makes `Intl.NumberFormat` (see `public/js/ui.js`) able to format amounts in it
 * instead of falling back to a plain `"RON 12.00"` string.
 */

/** `code` - ISO 4217, `name` - English name, `symbol` - how people write it. */
const CURRENCIES = [
  { code: 'ARS', name: 'Argentine peso', symbol: '$' },
  { code: 'AUD', name: 'Australian dollar', symbol: '$' },
  { code: 'BRL', name: 'Brazilian real', symbol: 'R$' },
  { code: 'CAD', name: 'Canadian dollar', symbol: '$' },
  { code: 'CHF', name: 'Swiss franc', symbol: 'CHF' },
  { code: 'CLP', name: 'Chilean peso', symbol: '$' },
  { code: 'CNY', name: 'Chinese yuan', symbol: '¥' },
  { code: 'COP', name: 'Colombian peso', symbol: '$' },
  { code: 'CZK', name: 'Czech koruna', symbol: 'Kč' },
  { code: 'DKK', name: 'Danish krone', symbol: 'kr' },
  { code: 'EGP', name: 'Egyptian pound', symbol: 'E£' },
  { code: 'EUR', name: 'Euro', symbol: '€' },
  { code: 'GBP', name: 'Pound sterling', symbol: '£' },
  { code: 'HKD', name: 'Hong Kong dollar', symbol: '$' },
  { code: 'HUF', name: 'Hungarian forint', symbol: 'Ft' },
  { code: 'IDR', name: 'Indonesian rupiah', symbol: 'Rp' },
  { code: 'ILS', name: 'Israeli new shekel', symbol: '₪' },
  { code: 'INR', name: 'Indian rupee', symbol: '₹' },
  { code: 'ISK', name: 'Icelandic króna', symbol: 'kr' },
  { code: 'JPY', name: 'Japanese yen', symbol: '¥' },
  { code: 'KES', name: 'Kenyan shilling', symbol: 'KSh' },
  { code: 'KRW', name: 'South Korean won', symbol: '₩' },
  { code: 'MXN', name: 'Mexican peso', symbol: '$' },
  { code: 'MYR', name: 'Malaysian ringgit', symbol: 'RM' },
  { code: 'NGN', name: 'Nigerian naira', symbol: '₦' },
  { code: 'NOK', name: 'Norwegian krone', symbol: 'kr' },
  { code: 'NZD', name: 'New Zealand dollar', symbol: '$' },
  { code: 'PHP', name: 'Philippine peso', symbol: '₱' },
  { code: 'PLN', name: 'Polish złoty', symbol: 'zł' },
  { code: 'RON', name: 'Romanian leu', symbol: 'lei' },
  { code: 'RSD', name: 'Serbian dinar', symbol: 'din' },
  { code: 'SEK', name: 'Swedish krona', symbol: 'kr' },
  { code: 'SGD', name: 'Singapore dollar', symbol: '$' },
  { code: 'THB', name: 'Thai baht', symbol: '฿' },
  { code: 'TRY', name: 'Turkish lira', symbol: '₺' },
  { code: 'UAH', name: 'Ukrainian hryvnia', symbol: '₴' },
  { code: 'USD', name: 'US dollar', symbol: '$' },
  { code: 'ZAR', name: 'South African rand', symbol: 'R' },
];

const BY_CODE = new Map(CURRENCIES.map((currency) => [currency.code, currency]));

/** Every supported code, in the order the picker shows them (alphabetical). */
const CODES = CURRENCIES.map((currency) => currency.code);

/** Normalises user input: `" ron "` and `"RON"` are the same currency. */
function normalise(value) {
  return String(value ?? '').trim().toUpperCase();
}

/** `true` when we can bill and format in this code. */
function isSupported(value) {
  return BY_CODE.has(normalise(value));
}

/** The wording used in the picker and in the settings summary. */
function label(value) {
  const found = BY_CODE.get(normalise(value));
  return found ? `${found.code} — ${found.name} (${found.symbol})` : String(value ?? '');
}

/** `[{ value, label }]`, ready for `ui.select()`. */
function options() {
  return CURRENCIES.map((currency) => ({ value: currency.code, label: label(currency.code) }));
}

module.exports = { CURRENCIES, CODES, normalise, isSupported, options, label };
