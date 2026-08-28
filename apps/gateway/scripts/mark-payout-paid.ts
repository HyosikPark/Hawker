/**
 * 운영자용: 수동 송금 완료 후 정산 건을 paid로 기록.
 * 사용법: tsx scripts/mark-payout-paid.ts <payoutId> <txRef>
 * (프로덕션: fly ssh console에서 실행)
 */
import { eq } from 'drizzle-orm';
import { db, payouts } from '@hawker/db';

const [payoutId, txRef] = process.argv.slice(2);
if (!payoutId || !txRef) {
  console.error('사용법: tsx scripts/mark-payout-paid.ts <payoutId> <txRef>');
  process.exit(1);
}
const row = db.select().from(payouts).where(eq(payouts.id, payoutId)).get();
if (!row) {
  console.error(`정산 건 없음: ${payoutId}`);
  process.exit(1);
}
if (row.status === 'paid') {
  console.error('이미 paid 처리된 건입니다.');
  process.exit(1);
}
db.update(payouts)
  .set({ status: 'paid', txRef, paidAt: new Date() })
  .where(eq(payouts.id, payoutId))
  .run();
console.log(`✅ paid 처리: ${payoutId} (${row.amountUsdMicros} micros → ${row.payoutAddress}, tx: ${txRef})`);
