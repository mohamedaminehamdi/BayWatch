import { handle, operatorData, requireOperator } from '@/lib/server';

// Operator dashboard data: live bay, blocked-bay alerts (with plates until resolved), event log, 7-day stats
export const GET = () =>
  handle(async () => {
    await requireOperator();
    return operatorData();
  });
