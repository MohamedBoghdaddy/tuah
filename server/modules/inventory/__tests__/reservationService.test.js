import { jest } from "@jest/globals";

const VALID_PRODUCT = "123e4567-e89b-12d3-a456-426614174000";
const VALID_LOCATION = "223e4567-e89b-12d3-a456-426614174000";
const VALID_ORDER = "323e4567-e89b-12d3-a456-426614174000";

const mockRepo = {
  reserveStock: jest.fn(),
  releaseReservation: jest.fn(),
  consumeReservation: jest.fn(),
  listReservations: jest.fn(),
};

jest.unstable_mockModule("../repository/reservations.repo.js", () => mockRepo);

const { reserveStock, releaseReservation, consumeReservation } = await import("../services/reservationService.js");

beforeEach(() => {
  jest.clearAllMocks();
});

describe("reserveStock validation", () => {
  test("rejects an invalid productId without touching the repository", async () => {
    const result = await reserveStock({ productId: "nope", locationId: VALID_LOCATION, quantity: 1, referenceType: "order", referenceId: VALID_ORDER });
    expect(result.error).toMatch(/productId/);
    expect(mockRepo.reserveStock).not.toHaveBeenCalled();
  });

  test("rejects a missing/invalid locationId", async () => {
    const result = await reserveStock({ productId: VALID_PRODUCT, locationId: "", quantity: 1, referenceType: "order", referenceId: VALID_ORDER });
    expect(result.error).toMatch(/locationId/);
  });

  test.each([0, -1, -100, NaN, "abc"])("rejects non-positive quantity %p", async (quantity) => {
    const result = await reserveStock({ productId: VALID_PRODUCT, locationId: VALID_LOCATION, quantity, referenceType: "order", referenceId: VALID_ORDER });
    expect(result.error).toMatch(/Quantity/);
    expect(mockRepo.reserveStock).not.toHaveBeenCalled();
  });

  test("rejects a missing referenceType", async () => {
    const result = await reserveStock({ productId: VALID_PRODUCT, locationId: VALID_LOCATION, quantity: 1, referenceId: VALID_ORDER });
    expect(result.error).toMatch(/referenceType/);
  });

  test("rejects an invalid referenceId", async () => {
    const result = await reserveStock({ productId: VALID_PRODUCT, locationId: VALID_LOCATION, quantity: 1, referenceType: "order", referenceId: "not-a-uuid" });
    expect(result.error).toMatch(/referenceId/);
  });

  test("calls the repository with normalized args on valid input", async () => {
    mockRepo.reserveStock.mockResolvedValue({ id: "r1", status: "active", quantity: 2 });
    const result = await reserveStock(
      { productId: VALID_PRODUCT, locationId: VALID_LOCATION, quantity: "2", referenceType: "order", referenceId: VALID_ORDER },
      "actor-1"
    );
    expect(mockRepo.reserveStock).toHaveBeenCalledWith({
      productId: VALID_PRODUCT,
      locationId: VALID_LOCATION,
      quantity: 2,
      referenceType: "order",
      referenceId: VALID_ORDER,
      createdBy: "actor-1",
    });
    expect(result.reservation.id).toBe("r1");
  });

  test("propagates insufficient-stock errors raised by the repository (DB-level lock/guard)", async () => {
    mockRepo.reserveStock.mockRejectedValue(new Error("insufficient_available_stock: requested 10 but only 3 available"));
    await expect(
      reserveStock({ productId: VALID_PRODUCT, locationId: VALID_LOCATION, quantity: 10, referenceType: "order", referenceId: VALID_ORDER })
    ).rejects.toThrow(/insufficient_available_stock/);
  });
});

describe("releaseReservation", () => {
  test("delegates to the repository", async () => {
    mockRepo.releaseReservation.mockResolvedValue({ id: "r1", status: "released" });
    const result = await releaseReservation("r1", "actor-1");
    expect(mockRepo.releaseReservation).toHaveBeenCalledWith("r1", "actor-1");
    expect(result.reservation.status).toBe("released");
  });

  test("propagates 'already released' guard errors from the repository", async () => {
    mockRepo.releaseReservation.mockRejectedValue(new Error("reservation_not_active: reservation r1 is released"));
    await expect(releaseReservation("r1", "actor-1")).rejects.toThrow(/reservation_not_active/);
  });
});

describe("consumeReservation", () => {
  test("defaults movementType to customer_order", async () => {
    mockRepo.consumeReservation.mockResolvedValue({ id: "r1", status: "consumed" });
    await consumeReservation("r1", {}, "actor-1");
    expect(mockRepo.consumeReservation).toHaveBeenCalledWith("r1", {
      movementType: "customer_order",
      referenceType: undefined,
      referenceId: undefined,
      actorId: "actor-1",
      notes: undefined,
    });
  });

  test("passes through an explicit movementType", async () => {
    mockRepo.consumeReservation.mockResolvedValue({ id: "r1", status: "consumed" });
    await consumeReservation("r1", { movementType: "manufacturing_consumption" }, "actor-1");
    expect(mockRepo.consumeReservation).toHaveBeenCalledWith(
      "r1",
      expect.objectContaining({ movementType: "manufacturing_consumption" })
    );
  });
});
