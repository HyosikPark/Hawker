import { Hono } from 'hono';

/**
 * 자체 호스팅 데이터셋 (무료 미끼 툴용).
 * 법정동코드(LAWD_CD) 앞 5자리 — 실거래가 API의 필수 인자인데 에이전트가 알 수 없어서 제공.
 * 서울 25개 구부터 시작 (검증된 표준 코드). 추후 전국 확장.
 */

interface District {
  code: string;
  nameKo: string;
  nameEn: string;
  city: string;
}

const DISTRICTS: District[] = [
  { code: '11110', nameKo: '종로구', nameEn: 'Jongno-gu', city: 'Seoul' },
  { code: '11140', nameKo: '중구', nameEn: 'Jung-gu', city: 'Seoul' },
  { code: '11170', nameKo: '용산구', nameEn: 'Yongsan-gu', city: 'Seoul' },
  { code: '11200', nameKo: '성동구', nameEn: 'Seongdong-gu', city: 'Seoul' },
  { code: '11215', nameKo: '광진구', nameEn: 'Gwangjin-gu', city: 'Seoul' },
  { code: '11230', nameKo: '동대문구', nameEn: 'Dongdaemun-gu', city: 'Seoul' },
  { code: '11260', nameKo: '중랑구', nameEn: 'Jungnang-gu', city: 'Seoul' },
  { code: '11290', nameKo: '성북구', nameEn: 'Seongbuk-gu', city: 'Seoul' },
  { code: '11305', nameKo: '강북구', nameEn: 'Gangbuk-gu', city: 'Seoul' },
  { code: '11320', nameKo: '도봉구', nameEn: 'Dobong-gu', city: 'Seoul' },
  { code: '11350', nameKo: '노원구', nameEn: 'Nowon-gu', city: 'Seoul' },
  { code: '11380', nameKo: '은평구', nameEn: 'Eunpyeong-gu', city: 'Seoul' },
  { code: '11410', nameKo: '서대문구', nameEn: 'Seodaemun-gu', city: 'Seoul' },
  { code: '11440', nameKo: '마포구', nameEn: 'Mapo-gu', city: 'Seoul' },
  { code: '11470', nameKo: '양천구', nameEn: 'Yangcheon-gu', city: 'Seoul' },
  { code: '11500', nameKo: '강서구', nameEn: 'Gangseo-gu', city: 'Seoul' },
  { code: '11530', nameKo: '구로구', nameEn: 'Guro-gu', city: 'Seoul' },
  { code: '11545', nameKo: '금천구', nameEn: 'Geumcheon-gu', city: 'Seoul' },
  { code: '11560', nameKo: '영등포구', nameEn: 'Yeongdeungpo-gu', city: 'Seoul' },
  { code: '11590', nameKo: '동작구', nameEn: 'Dongjak-gu', city: 'Seoul' },
  { code: '11620', nameKo: '관악구', nameEn: 'Gwanak-gu', city: 'Seoul' },
  { code: '11650', nameKo: '서초구', nameEn: 'Seocho-gu', city: 'Seoul' },
  { code: '11680', nameKo: '강남구', nameEn: 'Gangnam-gu', city: 'Seoul' },
  { code: '11710', nameKo: '송파구', nameEn: 'Songpa-gu', city: 'Seoul' },
  { code: '11740', nameKo: '강동구', nameEn: 'Gangdong-gu', city: 'Seoul' },
];

export const datasets = new Hono();

datasets.get('/lawd-cd', (c) => {
  const q = (c.req.query('q') ?? '').trim().toLowerCase();
  const matches = q
    ? DISTRICTS.filter(
        (d) =>
          d.nameKo.includes(q) ||
          d.nameEn.toLowerCase().includes(q) ||
          d.city.toLowerCase().includes(q) ||
          d.code.startsWith(q),
      )
    : DISTRICTS;
  return c.json({
    coverage: 'Seoul (25 districts). More regions coming.',
    matches,
  });
});
