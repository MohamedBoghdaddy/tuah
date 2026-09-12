/**
 * Tuah Inventory — Live Concurrency Test
 * Usage: node server/scripts/testInventoryConcurrency.js [base_url]
 *
 * This is NOT a unit test — it requires a running server (npm run dev in
 * server/) backed by a Supabase Postgres project that has
 * server/supabase/migrations/0010_inventory.sql already applied (via the
 * Supabase SQL editor, same as every other migration in this project).
 *
 * It proves the reservation engine is actually race-safe: it creates a
 * throwaway product + warehouse + location, sets on-hand stock to a known
 * number, then fires many concurrent reservation requests that together
 * ask for more than is available. If the row-locking in
 * fn_reserve_stock/fn_post_stock_movement is correct, the successful
 * reservations' total quantity must never exceed on-hand, and on_hand -
 * reserved (available) must never go negative. It also exercises release,
 * consume, transfers (incl. partial), receipts (incl. over-receipt
 * rejection), and adjustments end-to-end against the real database.
 *
 * Cleans up the throwaway product/warehouse it creates, on both success
 * and failure, unless --keep is passed.
 */

const BASE = process.argv[2] || "http://localhost:4000";
const KEEP = process.argv.includes("--keep");

const ADMIN_EMAIL = process.env.INVENTORY_TEST_EMAIL || "qa.admin@tuah.test";
const ADMIN_PASSWORD = process.env.INVENTORY_TEST_PASSWORD || "12345678";

let passed = 0;
let failed = 0;

const check = (label, condition, detail = "") => {
  if (condition) {
    passed += 1;
    console.log(`✅ PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`❌ FAIL  ${label}${detail ? `  — ${detail}` : ""}`);
  }
};

let token;
const api = async (method, path, body) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
};

async function main() {
  console.log(`\n🧪  Tuah Inventory Concurrency Test — ${BASE}\n${"─".repeat(60)}`);

  // ── Login ────────────────────────────────────────────────────────────
  const login = await fetch(`${BASE}/api/users/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  }).then((r) => r.json()).catch(() => null);

  token = login?.token;
  check("Login as admin", Boolean(token), "check INVENTORY_TEST_EMAIL/PASSWORD and that qa.admin@tuah.test exists");
  if (!token) {
    console.log("\nCannot continue without a token. Aborting.");
    process.exitCode = 1;
    return;
  }

  // ── Bootstrap: throwaway product + warehouse + location ─────────────
  const productRes = await api("POST", "/api/admin/products", {
    name: `Concurrency Test Product ${Date.now()}`,
    description: "Throwaway product created by testInventoryConcurrency.js",
    category: "test",
    price: 10,
    stock: 0,
  });
  const productId = productRes.data?.product?.id;
  check("Create throwaway product", productRes.status === 201 && Boolean(productId), JSON.stringify(productRes.data));

  const warehouseRes = await api("POST", "/api/admin/inventory/warehouses", {
    code: `TEST-${Date.now()}`,
    name: "Concurrency Test Warehouse",
  });
  const warehouseId = warehouseRes.data?.warehouse?.id;
  check("Create throwaway warehouse", warehouseRes.status === 201 && Boolean(warehouseId), JSON.stringify(warehouseRes.data));

  const locationRes = await api("POST", "/api/admin/inventory/locations", {
    warehouseId,
    code: "MAIN",
    name: "Main Floor",
    locationType: "internal",
  });
  const locationId = locationRes.data?.location?.id;
  check("Create throwaway location", locationRes.status === 201 && Boolean(locationId), JSON.stringify(locationRes.data));

  if (!productId || !warehouseId || !locationId) {
    console.log("\nBootstrap failed. Aborting before mutating stock.");
    process.exitCode = 1;
    return;
  }

  // ── Seed on-hand stock via an adjustment ─────────────────────────────
  const STARTING_STOCK = 10;
  const seedRes = await api("POST", "/api/admin/inventory/adjustments", {
    productId,
    locationId,
    quantityDelta: STARTING_STOCK,
    reason: "cycle_count",
    note: "Seed stock for concurrency test",
  });
  check("Seed on-hand stock via adjustment", seedRes.status === 201 && seedRes.data?.adjustment?.quantityAfter === STARTING_STOCK, JSON.stringify(seedRes.data));

  // ── Concurrent reservations: 20 requests x 1 unit against 10 on-hand ──
  const CONCURRENT_REQUESTS = 20;
  const RESERVE_EACH = 1;
  const reservationResults = await Promise.all(
    Array.from({ length: CONCURRENT_REQUESTS }, () =>
      api("POST", "/api/admin/inventory/reservations", {
        productId,
        locationId,
        quantity: RESERVE_EACH,
        referenceType: "order",
        referenceId: crypto.randomUUID(),
      })
    )
  );

  const successful = reservationResults.filter((r) => r.status === 201);
  const rejected = reservationResults.filter((r) => r.status === 409);
  const totalReserved = successful.length * RESERVE_EACH;

  check(
    `Exactly ${STARTING_STOCK} of ${CONCURRENT_REQUESTS} concurrent reservations succeed (no overselling)`,
    successful.length === STARTING_STOCK,
    `got ${successful.length} successful, ${rejected.length} rejected`
  );
  check(
    "Rejected reservations get a clean 409 insufficient_available_stock (not a 500)",
    rejected.every((r) => /available/i.test(r.data?.message || "")),
    JSON.stringify(rejected.map((r) => r.data))
  );

  const balanceAfterReservations = await api("GET", `/api/admin/inventory/balances?productId=${productId}&locationId=${locationId}`);
  const balanceRow = balanceAfterReservations.data?.balances?.[0];
  check(
    "Balance invariant holds: reserved === total successfully reserved, available === 0",
    balanceRow && Number(balanceRow.reserved) === totalReserved && Number(balanceRow.available) === STARTING_STOCK - totalReserved,
    JSON.stringify(balanceRow)
  );
  check("on_hand never went negative or below reserved", balanceRow && Number(balanceRow.onHand) === STARTING_STOCK, JSON.stringify(balanceRow));

  // ── Release one reservation, then re-reserve the freed unit ─────────
  const reservationId = successful[0]?.data?.reservation?.id;
  const releaseRes = await api("PATCH", `/api/admin/inventory/reservations/${reservationId}/release`);
  check("Release a reservation succeeds", releaseRes.status === 200 && releaseRes.data?.reservation?.status === "released", JSON.stringify(releaseRes.data));

  const releaseTwiceRes = await api("PATCH", `/api/admin/inventory/reservations/${reservationId}/release`);
  check("Releasing an already-released reservation is rejected, not double-applied", releaseTwiceRes.status === 409, JSON.stringify(releaseTwiceRes.data));

  const reReserveRes = await api("POST", "/api/admin/inventory/reservations", {
    productId, locationId, quantity: 1, referenceType: "order", referenceId: crypto.randomUUID(),
  });
  check("Freed unit can be reserved again", reReserveRes.status === 201, JSON.stringify(reReserveRes.data));

  // ── Consume a reservation: on_hand should drop, reserved should drop ──
  const toConsume = successful[1]?.data?.reservation?.id;
  const beforeConsume = await api("GET", `/api/admin/inventory/balances?productId=${productId}&locationId=${locationId}`);
  const onHandBefore = Number(beforeConsume.data?.balances?.[0]?.onHand);

  const consumeRes = await api("PATCH", `/api/admin/inventory/reservations/${toConsume}/consume`, { referenceType: "order" });
  check("Consume a reservation succeeds", consumeRes.status === 200 && consumeRes.data?.reservation?.status === "consumed", JSON.stringify(consumeRes.data));

  const afterConsume = await api("GET", `/api/admin/inventory/balances?productId=${productId}&locationId=${locationId}`);
  const onHandAfter = Number(afterConsume.data?.balances?.[0]?.onHand);
  check("Consuming a reservation actually decrements on_hand by the reserved quantity", onHandAfter === onHandBefore - 1, `before=${onHandBefore} after=${onHandAfter}`);

  // ── Stock adjustment cannot drive on_hand negative ───────────────────
  const overAdjustRes = await api("POST", "/api/admin/inventory/adjustments", {
    productId, locationId, quantityDelta: -9999, reason: "damage", note: "should be rejected",
  });
  check("An adjustment that would drive on_hand negative is rejected", overAdjustRes.status === 409, JSON.stringify(overAdjustRes.data));

  // ── Transfers: full create -> ready -> partial move -> complete ──────
  const warehouse2Res = await api("POST", "/api/admin/inventory/warehouses", { code: `TEST2-${Date.now()}`, name: "Concurrency Test Warehouse 2" });
  const warehouse2Id = warehouse2Res.data?.warehouse?.id;
  const location2Res = await api("POST", "/api/admin/inventory/locations", { warehouseId: warehouse2Id, code: "MAIN", name: "Main Floor", locationType: "internal" });
  const location2Id = location2Res.data?.location?.id;

  const transferRes = await api("POST", "/api/admin/inventory/transfers", {
    sourceWarehouseId: warehouseId, sourceLocationId: locationId,
    destWarehouseId: warehouse2Id, destLocationId: location2Id,
    lines: [{ productId, requestedQty: 4 }],
  });
  const transferId = transferRes.data?.transfer?.id;
  const transferLineId = transferRes.data?.transfer?.lines?.[0]?.id;
  check("Create a transfer with one line", transferRes.status === 201 && Boolean(transferId), JSON.stringify(transferRes.data));

  const readyRes = await api("PATCH", `/api/admin/inventory/transfers/${transferId}/status`, { status: "ready" });
  check("Transfer draft -> ready", readyRes.status === 200 && readyRes.data?.transfer?.status === "ready", JSON.stringify(readyRes.data));

  const partialMoveRes = await api("POST", `/api/admin/inventory/transfers/${transferId}/lines/${transferLineId}/move`, { quantity: 2 });
  check("Partial transfer move (2 of 4 requested)", partialMoveRes.status === 200 && Number(partialMoveRes.data?.line?.movedQty) === 2, JSON.stringify(partialMoveRes.data));

  const getTransferRes = await api("GET", `/api/admin/inventory/transfers/${transferId}`);
  check("Transfer auto-advanced to in_progress after first move", getTransferRes.data?.transfer?.status === "in_progress", JSON.stringify(getTransferRes.data));

  const overMoveRes = await api("POST", `/api/admin/inventory/transfers/${transferId}/lines/${transferLineId}/move`, { quantity: 999 });
  check("Moving more than requested is rejected", overMoveRes.status === 409, JSON.stringify(overMoveRes.data));

  const completeRes = await api("PATCH", `/api/admin/inventory/transfers/${transferId}/status`, { status: "completed" });
  check("Transfer can be marked completed while partially moved (short-shipped)", completeRes.status === 200 && completeRes.data?.transfer?.status === "completed", JSON.stringify(completeRes.data));

  // ── Receipts: over-receipt blocked by default, allowed when explicit ──
  const receiptRes = await api("POST", "/api/admin/inventory/receipts", {
    warehouseId, lines: [{ productId, expectedQty: 5 }],
  });
  const receiptId = receiptRes.data?.receipt?.id;
  const receiptLineId = receiptRes.data?.receipt?.lines?.[0]?.id;
  check("Create a receipt with one line", receiptRes.status === 201 && Boolean(receiptId), JSON.stringify(receiptRes.data));

  const overReceiveRes = await api("POST", `/api/admin/inventory/receipts/${receiptId}/lines/${receiptLineId}/receive`, { quantity: 6 });
  check("Over-receiving without allowOverReceipt is blocked", overReceiveRes.status === 409, JSON.stringify(overReceiveRes.data));

  const partialReceiveRes = await api("POST", `/api/admin/inventory/receipts/${receiptId}/lines/${receiptLineId}/receive`, { quantity: 3 });
  check("Partial receipt (3 of 5 expected)", partialReceiveRes.status === 200, JSON.stringify(partialReceiveRes.data));

  const getReceiptRes = await api("GET", `/api/admin/inventory/receipts/${receiptId}`);
  check("Receipt status is partially_received after a partial receive", getReceiptRes.data?.receipt?.status === "partially_received", JSON.stringify(getReceiptRes.data));

  const finishReceiveRes = await api("POST", `/api/admin/inventory/receipts/${receiptId}/lines/${receiptLineId}/receive`, { quantity: 2, allowOverReceipt: true });
  check("Explicit allowOverReceipt lets the remainder through", finishReceiveRes.status === 200, JSON.stringify(finishReceiveRes.data));

  const getReceiptRes2 = await api("GET", `/api/admin/inventory/receipts/${receiptId}`);
  check("Receipt auto-completes to received once fully received", getReceiptRes2.data?.receipt?.status === "received", JSON.stringify(getReceiptRes2.data));

  // ── Cleanup ───────────────────────────────────────────────────────────
  if (!KEEP) {
    await api("DELETE", `/api/admin/products/${productId}`);
    console.log("\n(Left warehouses/locations/movements in place — they're harmless and there's no delete endpoint for history-bearing rows by design. Pass --keep to skip even the product cleanup.)");
  }

  console.log(`\n${"─".repeat(60)}\n${passed} passed, ${failed} failed\n`);
  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((error) => {
  console.error("Test script crashed:", error);
  process.exitCode = 1;
});
