import { jest } from "@jest/globals";

const VALID_PRODUCT = "123e4567-e89b-12d3-a456-426614174000";
const VALID_LOCATION = "223e4567-e89b-12d3-a456-426614174000";

const mockRepo = { executeAdjustment: jest.fn(), listAdjustments: jest.fn() };
jest.unstable_mockModule("../repository/adjustments.repo.js", () => mockRepo);

const { createAdjustment } = await import("../services/adjustmentService.js");

beforeEach(() => jest.clearAllMocks());

describe("createAdjustment validation", () => {
  test("rejects invalid productId", async () => {
    const result = await createAdjustment({ productId: "x", locationId: VALID_LOCATION, quantityDelta: 1, reason: "damage", note: "broke in transit" }, "actor-1");
    expect(result.error).toMatch(/productId/);
    expect(mockRepo.executeAdjustment).not.toHaveBeenCalled();
  });

  test("rejects invalid locationId", async () => {
    const result = await createAdjustment({ productId: VALID_PRODUCT, locationId: "x", quantityDelta: 1, reason: "damage", note: "n" }, "actor-1");
    expect(result.error).toMatch(/locationId/);
  });

  test.each([0, NaN])("rejects a zero/non-numeric quantityDelta (%p)", async (quantityDelta) => {
    const result = await createAdjustment({ productId: VALID_PRODUCT, locationId: VALID_LOCATION, quantityDelta, reason: "damage", note: "n" }, "actor-1");
    expect(result.error).toMatch(/quantityDelta/);
  });

  test("rejects an unknown reason", async () => {
    const result = await createAdjustment({ productId: VALID_PRODUCT, locationId: VALID_LOCATION, quantityDelta: -1, reason: "because", note: "n" }, "actor-1");
    expect(result.error).toMatch(/reason/);
  });

  test("requires a non-empty note — adjustments must always explain themselves", async () => {
    const result = await createAdjustment({ productId: VALID_PRODUCT, locationId: VALID_LOCATION, quantityDelta: -1, reason: "damage", note: "   " }, "actor-1");
    expect(result.error).toMatch(/note/i);
    expect(mockRepo.executeAdjustment).not.toHaveBeenCalled();
  });

  test("calls the repository with a trimmed note on valid input", async () => {
    mockRepo.executeAdjustment.mockResolvedValue({ id: "a1", quantityDelta: -2 });
    const result = await createAdjustment(
      { productId: VALID_PRODUCT, locationId: VALID_LOCATION, quantityDelta: -2, reason: "damage", note: "  crushed in transit  " },
      "actor-1"
    );
    expect(mockRepo.executeAdjustment).toHaveBeenCalledWith({
      productId: VALID_PRODUCT,
      locationId: VALID_LOCATION,
      quantityDelta: -2,
      reason: "damage",
      note: "crushed in transit",
      actorId: "actor-1",
    });
    expect(result.adjustment.id).toBe("a1");
  });

  test("propagates 'would go negative' guard errors raised by the DB function", async () => {
    mockRepo.executeAdjustment.mockRejectedValue(new Error("insufficient_on_hand_stock: requested 5 but only 2 on hand"));
    await expect(
      createAdjustment({ productId: VALID_PRODUCT, locationId: VALID_LOCATION, quantityDelta: -5, reason: "damage", note: "n" }, "actor-1")
    ).rejects.toThrow(/insufficient_on_hand_stock/);
  });
});
