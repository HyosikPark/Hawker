/** 공용 검증·정리 유틸 (가격 경계, 판매자 텍스트 살균). */

export const MAX_PRICE_USD_MICROS = 100_000_000; // $100
export const MAX_DESC_LEN = 600;
export const MAX_NAME_LEN = 80;

export function priceInBounds(v: unknown): v is number {
  return Number.isInteger(v) && (v as number) >= 0 && (v as number) <= MAX_PRICE_USD_MICROS;
}

/**
 * 판매자 제공 텍스트(툴 이름/설명/상품명)를 구매 에이전트에 노출하기 전 살균.
 * - 개행/탭 → 공백, 나머지 제어문자(C0/C1) 제거 (프롬프트 인젝션의 개행 트릭 완화)
 * - 연속 공백 축약, 길이 상한
 */
export function sanitizeText(input: unknown, maxLen: number): string {
  const s = typeof input === 'string' ? input : '';
  let out = '';
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (ch === '\n' || ch === '\r' || ch === '\t') {
      out += ' ';
    } else if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) {
      // C0/C1 제어문자 제거
      continue;
    } else {
      out += ch;
    }
  }
  out = out.replace(/\s{2,}/g, ' ').trim();
  return out.length > maxLen ? out.slice(0, maxLen - 1).trimEnd() + '…' : out;
}
