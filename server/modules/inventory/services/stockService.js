import * as balancesRepo from "../repository/balances.repo.js";
import { MOVEMENT_TYPES } from "../constants.js";

export const getOverview = async () => {
  const [
    totalWarehouses,
    activeWarehouses,
    totalLocations,
    onHandValue,
    activeReservations,
    openTransfers,
    openReceipts,
  ] = await Promise.all([
    balancesRepo.countWarehouses(),
    balancesRepo.countWarehouses({ activeOnly: true }),
    balancesRepo.countLocations(),
    balancesRepo.sumOnHandValue(),
    balancesRepo.countActiveReservations(),
    balancesRepo.countOpenTransfers(),
    balancesRepo.countOpenReceipts(),
  ]);

  return {
    totalWarehouses,
    activeWarehouses,
    totalLocations,
    onHandValue,
    activeReservations,
    openTransfers,
    openReceipts,
  };
};

export const listBalances = (filters) => balancesRepo.listBalances(filters);

export const listMovements = (filters) => {
  if (filters.movementType && !MOVEMENT_TYPES.includes(filters.movementType)) {
    return Promise.reject(new Error(`Invalid movement type. Must be one of: ${MOVEMENT_TYPES.join(", ")}`));
  }
  return balancesRepo.listMovements(filters);
};

// Full inventory picture for a single product: on hand/reserved/available
// per location, plus incoming (open receipts) and outgoing (open transfers),
// plus recent movement history. Everything here is a real derived number.
export const getProductInventoryDetail = async (productId) => {
  const [balances, incoming, outgoing, movementHistory] = await Promise.all([
    balancesRepo.getBalancesForProduct(productId),
    balancesRepo.sumIncomingByProduct([productId]),
    balancesRepo.sumOutgoingByProduct([productId]),
    balancesRepo.listMovements({ productId, limit: 50 }),
  ]);

  const totals = balances.reduce(
    (acc, b) => ({ onHand: acc.onHand + b.onHand, reserved: acc.reserved + b.reserved, available: acc.available + b.available }),
    { onHand: 0, reserved: 0, available: 0 }
  );

  return {
    productId,
    totals: {
      ...totals,
      incoming: incoming[productId] || 0,
      outgoing: outgoing[productId] || 0,
    },
    balances,
    recentMovements: movementHistory.movements,
  };
};
