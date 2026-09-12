import { jest } from "@jest/globals";

const PRODUCT_A = "123e4567-e89b-12d3-a456-426614174000";
const WAREHOUSE_A = "223e4567-e89b-12d3-a456-426614174000";

const mockReceiptsRepo = {
  listReceipts: jest.fn(),
  findReceiptById: jest.fn(),
  listReceiptLines: jest.fn(),
  createReceipt: jest.fn(),
  addReceiptLine: jest.fn(),
  removeReceiptLine: jest.fn(),
  updateReceiptStatus: jest.fn(),
  receiveLine: jest.fn(),
};
const mockWarehousesRepo = { findWarehouseById: jest.fn() };

jest.unstable_mockModule("../repository/receipts.repo.js", () => mockReceiptsRepo);
jest.unstable_mockModule("../repository/warehouses.repo.js", () => mockWarehousesRepo);

const receiptService = await import("../services/receiptService.js");

beforeEach(() => jest.clearAllMocks());

describe("createReceipt validation", () => {
  test("requires at least one line", async () => {
    const result = await receiptService.createReceipt({ warehouseId: WAREHOUSE_A, lines: [] }, "actor-1");
    expect(result.error).toMatch(/line/i);
  });

  test("rejects a negative expectedQty", async () => {
    const result = await receiptService.createReceipt(
      { warehouseId: WAREHOUSE_A, lines: [{ productId: PRODUCT_A, expectedQty: -1 }] },
      "actor-1"
    );
    expect(result.error).toMatch(/expectedQty/);
  });

  test("rejects an unknown warehouse", async () => {
    mockWarehousesRepo.findWarehouseById.mockResolvedValue(null);
    const result = await receiptService.createReceipt(
      { warehouseId: WAREHOUSE_A, lines: [{ productId: PRODUCT_A, expectedQty: 5 }] },
      "actor-1"
    );
    expect(result.error).toMatch(/Warehouse not found/);
  });

  test("creates header + lines, defaulting sourceType to supplier", async () => {
    mockWarehousesRepo.findWarehouseById.mockResolvedValue({ id: WAREHOUSE_A });
    mockReceiptsRepo.createReceipt.mockResolvedValue({ id: "rc1", status: "draft" });
    mockReceiptsRepo.addReceiptLine.mockImplementation(async (receiptId, line) => ({ id: "rl1", receiptId, ...line }));

    const result = await receiptService.createReceipt(
      { warehouseId: WAREHOUSE_A, lines: [{ productId: PRODUCT_A, expectedQty: 10 }] },
      "actor-1"
    );

    expect(mockReceiptsRepo.createReceipt).toHaveBeenCalledWith(expect.objectContaining({ source_type: "supplier", created_by: "actor-1" }));
    expect(result.receipt.lines).toHaveLength(1);
  });
});

describe("setStatus", () => {
  test("only allows cancelling a draft/partially_received receipt", async () => {
    mockReceiptsRepo.findReceiptById.mockResolvedValue({ id: "rc1", status: "received" });
    const result = await receiptService.setStatus("rc1", "cancelled");
    expect(result.error).toMatch(/Cannot move a receipt/);
  });

  test("allows draft -> cancelled", async () => {
    mockReceiptsRepo.findReceiptById.mockResolvedValue({ id: "rc1", status: "draft" });
    mockReceiptsRepo.updateReceiptStatus.mockResolvedValue({ id: "rc1", status: "cancelled" });
    const result = await receiptService.setStatus("rc1", "cancelled");
    expect(result.receipt.status).toBe("cancelled");
  });
});

describe("receiveLine", () => {
  test("rejects a non-positive quantity", async () => {
    mockReceiptsRepo.findReceiptById.mockResolvedValue({ id: "rc1", status: "draft" });
    const result = await receiptService.receiveLine("rc1", "rl1", { quantity: -1 }, "actor-1");
    expect(result.error).toMatch(/quantity/);
    expect(mockReceiptsRepo.receiveLine).not.toHaveBeenCalled();
  });

  test("passes allowOverReceipt through to the atomic repo function", async () => {
    mockReceiptsRepo.findReceiptById.mockResolvedValue({ id: "rc1", status: "draft" });
    mockReceiptsRepo.receiveLine.mockResolvedValue({ id: "rl1", receivedQty: 12 });
    await receiptService.receiveLine("rc1", "rl1", { quantity: 12, allowOverReceipt: true }, "actor-1");
    expect(mockReceiptsRepo.receiveLine).toHaveBeenCalledWith("rl1", 12, "actor-1", true);
  });

  test("propagates the over-receipt guard error from the DB function", async () => {
    mockReceiptsRepo.findReceiptById.mockResolvedValue({ id: "rc1", status: "draft" });
    mockReceiptsRepo.receiveLine.mockRejectedValue(new Error("over_receipt_not_allowed: line rl1 would receive 12 of 10 expected"));
    await expect(receiptService.receiveLine("rc1", "rl1", { quantity: 12 }, "actor-1")).rejects.toThrow(/over_receipt_not_allowed/);
  });
});
