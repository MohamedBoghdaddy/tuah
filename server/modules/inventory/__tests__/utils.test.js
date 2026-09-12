import { isValidId, toNumber, sanitizeString, mapInventoryError } from "../utils.js";

describe("isValidId", () => {
  test("accepts a valid uuid", () => {
    expect(isValidId("123e4567-e89b-12d3-a456-426614174000")).toBe(true);
  });
  test.each([undefined, null, "", "not-a-uuid", 123, "123e4567-e89b-12d3-a456"])(
    "rejects %p",
    (value) => {
      expect(isValidId(value)).toBe(false);
    }
  );
});

describe("toNumber", () => {
  test("parses numeric strings", () => {
    expect(toNumber("42")).toBe(42);
    expect(toNumber("3.5")).toBe(3.5);
  });
  test.each(["", null, undefined, "abc", "NaN"])("returns NaN for %p", (value) => {
    expect(Number.isNaN(toNumber(value))).toBe(true);
  });
});

describe("sanitizeString", () => {
  test("trims strings", () => {
    expect(sanitizeString("  hello  ")).toBe("hello");
  });
  test("passes through non-strings unchanged", () => {
    expect(sanitizeString(5)).toBe(5);
    expect(sanitizeString(undefined)).toBe(undefined);
  });
});

describe("mapInventoryError", () => {
  test.each([
    ["insufficient_available_stock: requested 5 but only 2 available", 409],
    ["insufficient_on_hand_stock: requested 5 but only 2 on hand", 409],
    ["reservation_not_active: reservation x is released", 409],
    ["reservation_not_found: x", 404],
    ["over_receipt_not_allowed: line x would receive 5 of 3 expected", 409],
    ["over_transfer: line x already moved 5 of 5 requested", 409],
    ["transfer_not_active: transfer x is completed", 409],
    ["transfer_line_not_found: x", 404],
    ["receipt_not_active: receipt x is received", 409],
    ["receipt_line_not_found: x", 404],
    ["missing_location: warehouse x has no internal location", 422],
    ["invalid_movement: quantity delta cannot be zero", 400],
    ["invalid_reservation: quantity must be positive", 400],
    ["invalid_transfer_move: quantity must be positive", 400],
    ["invalid_receipt: quantity must be positive", 400],
  ])("maps %p to status %p", (message, status) => {
    const result = mapInventoryError(new Error(message));
    expect(result.status).toBe(status);
    expect(result.message.length).toBeGreaterThan(0);
  });

  test("strips the machine-readable token from the message", () => {
    const result = mapInventoryError(new Error("insufficient_available_stock: requested 5 but only 2 available"));
    expect(result.message).toBe("requested 5 but only 2 available");
  });

  test("maps postgres unique-violation code to 409", () => {
    const error = Object.assign(new Error("duplicate key"), { code: "23505" });
    expect(mapInventoryError(error).status).toBe(409);
  });

  test("maps postgres FK-violation code to 409", () => {
    const error = Object.assign(new Error("fk violation"), { code: "23503" });
    expect(mapInventoryError(error).status).toBe(409);
  });

  test("maps postgres check-violation code to 400", () => {
    const error = Object.assign(new Error("check violation"), { code: "23514" });
    expect(mapInventoryError(error).status).toBe(400);
  });

  test("falls back to 500 for unrecognized errors", () => {
    const result = mapInventoryError(new Error("something exploded"));
    expect(result.status).toBe(500);
  });
});
