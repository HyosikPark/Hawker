/**
 * SSRF 방어: 판매자가 제출하는 URL(openapiUrl, upstreamBaseUrl)이
 * 내부망·루프백·링크로컬을 가리키지 못하게 차단한다.
 * 로컬 개발은 HAWKER_ALLOW_PRIVATE_UPSTREAM=1 로 해제 (.env).
 */

const PRIVATE_V4 = [
  /^127\./, // loopback
  /^10\./, // RFC1918
  /^192\.168\./, // RFC1918
  /^172\.(1[6-9]|2\d|3[01])\./, // RFC1918
  /^169\.254\./, // link-local (클라우드 메타데이터 포함)
  /^0\./,
];

const FORBIDDEN_HOSTS = [/^localhost$/i, /\.localhost$/i, /\.internal$/i, /^\[?::1\]?$/, /^\[?fd/i, /^\[?fe80/i];

export function forbiddenUpstreamReason(rawUrl: string): string | null {
  if (process.env.HAWKER_ALLOW_PRIVATE_UPSTREAM === '1') return null;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return '유효한 URL이 아닙니다.';
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return 'http(s) URL만 허용됩니다.';
  }
  const host = url.hostname;
  if (FORBIDDEN_HOSTS.some((re) => re.test(host))) {
    return `내부 호스트(${host})는 업스트림으로 쓸 수 없습니다.`;
  }
  if (PRIVATE_V4.some((re) => re.test(host))) {
    return `사설/루프백 IP(${host})는 업스트림으로 쓸 수 없습니다.`;
  }
  return null;
}
