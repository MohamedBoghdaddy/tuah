import { jest } from "@jest/globals";

const PRODUCT_A = "123e4567-e89b-12d3-a456-426614174000";
const WAREHOUSE_A = "223e4567-e89b-12d3-a456-426614174000";
const WAREHOUSE_B = "323e4567-e89b-12d3-a456-426614174000";

const mockTransfersRepo = {
  listTransfers: jest.fn(),
  findTransferById: jest.fn(),
  listTransferLines: jest.fn(),
  createTransfer: jest.fn(),
  addTransferLine: jest.fn(),
  removeTransferLine: jest.fn(),
  updateTransferStatus: jest.fn(),
  moveTransferLine: jest.fn(),
};
const mockWarehousesRepo = {
  findWarehouseById: jest.fn(),
};

jest.unstable_mockModule("../repository/transfers.repo.js", () => mockTransfersRepo);
jest.unstable_mockModule("../repository/warehouses.repo.js", () => mockWarehousesRepo);

const transferService = await import("../services/transferService.js");

beforeEach(() => jest.clearAllMocks());

describe("createTransfer validation", () => {
  test("requires at least one line", async () => {
    const result = await transferService.createTransfer(
      { sourceWarehouseId: WAREHOUSE_A, destWarehouseId: WAREHOUSE_B, lines: [] },
      "actor-1"
    );
    expect(result.error).toMatch(/line/i);
    expect(mockTransfersRepo.createTransfer).not.toHaveBeenCalled();
  });

  test("rejects a line with a non-positive requestedQty", async () => {
    const result = await transferService.createTransfer(
      { sourceWarehouseId: WAREHOUSE_A, destWarehouseId: WAREHOUSE_B, lines: [{ productId: PRODUCT_A, requestedQty: 0 }] },
      "actor-1"
    );
    expect(result.error).toMatch(/requestedQty/);
  });

  test("rejects when source and destination warehouse+location are identical", async () => {
    const result = await transferService.createTransfer(
      { sourceWarehouseId: WAREHOUSE_A, destWarehouseId: WAREHOUSE_A, lines: [{ productId: PRODUCT_A, requestedQty: 1 }] },
      "actor-1"
    );
    expect(result.error).toMatch(/same location/i);
    expect(mockWarehousesRepo.findWarehouseById).not.toHaveBeenCalled();
  });

  test("rejects an unknown destination warehouse", async () => {
    mockWarehousesRepo.findWarehouseById.mockImplementation(async (id) => (id === WAREHOUSE_A ? { id: WAREHOUSE_A } : null));
    const result = await transferService.createTransfer(
      { sourceWarehouseId: WAREHOUSE_A, destWarehouseId: WAREHOUSE_B, lines: [{ productId: PRODUCT_A, requestedQty: 1 }] },
      "actor-1"
    );
    expect(result.error).toMatch(/Destination warehouse/);
  });

  test("creates the header then each line in order", async () => {
    mockWarehousesRepo.findWarehouseById.mockResolvedValue({ id: "w" });
    mockTransfersRepo.createTransfer.mockResolvedValue({ id: "t1", status: "draft" });
    mockTransfersRepo.addTransferLine.mockImplementation(async (transferId, line) => ({ id: "l1", transferId, ...line }));

    const result = await transferService.createTransfer(
      {
        sourceWarehouseId: WAREHOUSE_A,
        destWarehouseId: WAREHOUSE_B,
        lines: [{ productId: PRODUCT_A, requestedQty: "5" }],
      },
      "actor-1"
    );

    expect(mockTransfersRepo.createTransfer).toHaveBeenCalledWith(expect.objectContaining({ created_by: "actor-1" }));
    expect(mockTransfersRepo.addTransferLine).toHaveBeenCalledWith("t1", { productId: PRODUCT_A, requestedQty: 5 });
    expect(result.transfer.lines).toHaveLength(1);
  });
});

describe("setStatus transitions", () => {
  test("rejects an unknown target status", async () => {
    const result = await transferService.setStatus("t1", "banana", "actor-1");
    expect(result.error).toMatch(/Status must be one of/);
  });

  test("404s when the transfer does not exist", async () => {
    mockTransfersRepo.findTransferById.mockResolvedValue(null);
    const result = await transferService.setStatus("t1", "ready", "actor-1");
    expect(result.notFound).toBe(true);
  });

  test("rejects an illegal transition (completed -> ready)", async () => {
    mockTransfersRepo.findTransferById.mockResolvedValue({ id: "t1", status: "completed" });
    const result = await transferService.setStatus("t1", "ready", "actor-1");
    expect(result.error).toMatch(/Cannot move a transfer/);
    expect(mockTransfersRepo.updateTransferStatus).not.toHaveBeenCalled();
  });

  test("rejects draft -> ready with zero lines", async () => {
    mockTransfersRepo.findTransferById.mockResolvedValue({ id: "t1", status: "draft" });
    mockTransfersRepo.listTransferLines.mockResolvedValue([]);
    const result = await transferService.setStatus("t1", "ready", "actor-1");
    expect(result.error).toMatch(/at least one line/i);
  });

  test("allows draft -> ready with at least one line", async () => {
    mockTransfersRepo.findTransferById.mockResolvedValue({ id: "t1", status: "draft" });
    mockTransfersRepo.listTransferLines.mockResolvedValue([{ id: "l1" }]);
    mockTransfersRepo.updateTransferStatus.mockResolvedValue({ id: "t1", status: "ready" });
    const result = await transferService.setStatus("t1", "ready", "actor-1");
    expect(result.transfer.status).toBe("ready");
  });

  test("allows in_progress -> cancelled (partial transfers can be abandoned)", async () => {
    mockTransfersRepo.findTransferById.mockResolvedValue({ id: "t1", status: "in_progress" });
    mockTransfersRepo.updateTransferStatus.mockResolvedValue({ id: "t1", status: "cancelled" });
    const result = await transferService.setStatus("t1", "cancelled", "actor-1");
    expect(result.transfer.status).toBe("cancelled");
  });
});

describe("moveLine", () => {
  test("rejects a non-positive quantity", async () => {
    mockTransfersRepo.findTransferById.mockResolvedValue({ id: "t1", status: "ready" });
    const result = await transferService.moveLine("t1", "l1", { quantity: 0 }, "actor-1");
    expect(result.error).toMatch(/quantity/);
    expect(mockTransfersRepo.moveTransferLine).not.toHaveBeenCalled();
  });

  test("delegates to the atomic repo function (partial transfer: less than requestedQty)", async () => {
    mockTransfersRepo.findTransferById.mockResolvedValue({ id: "t1", status: "ready" });
    mockTransfersRepo.moveTransferLine.mockResolvedValue({ id: "l1", requestedQty: 10, movedQty: 4 });
    const result = await transferService.moveLine("t1", "l1", { quantity: 4 }, "actor-1");
    expect(mockTransfersRepo.moveTransferLine).toHaveBeenCalledWith("l1", 4, "actor-1");
    expect(result.line.movedQty).toBe(4);
  });

  test("propagates 'transfer not active' guard errors from the DB function", async () => {
    mockTransfersRepo.findTransferById.mockResolvedValue({ id: "t1", status: "completed" });
    mockTransfersRepo.moveTransferLine.mockRejectedValue(new Error("transfer_not_active: transfer t1 is completed"));
    await expect(transferService.moveLine("t1", "l1", { quantity: 1 }, "actor-1")).rejects.toThrow(/transfer_not_active/);
  });
});
