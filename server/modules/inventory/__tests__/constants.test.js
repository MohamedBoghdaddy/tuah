import {
  TRANSFER_STATUSES,
  TRANSFER_STATUS_TRANSITIONS,
  RECEIPT_STATUSES,
  RECEIPT_STATUS_TRANSITIONS,
} from "../constants.js";

describe("TRANSFER_STATUS_TRANSITIONS", () => {
  test("has an entry for every status", () => {
    TRANSFER_STATUSES.forEach((status) => {
      expect(TRANSFER_STATUS_TRANSITIONS[status]).toBeDefined();
    });
  });

  test("only points at known statuses", () => {
    Object.values(TRANSFER_STATUS_TRANSITIONS)
      .flat()
      .forEach((status) => expect(TRANSFER_STATUSES).toContain(status));
  });

  test("terminal states have no outgoing transitions", () => {
    expect(TRANSFER_STATUS_TRANSITIONS.completed).toEqual([]);
    expect(TRANSFER_STATUS_TRANSITIONS.cancelled).toEqual([]);
  });

  test("draft can reach cancelled but not completed directly", () => {
    expect(TRANSFER_STATUS_TRANSITIONS.draft).toContain("cancelled");
    expect(TRANSFER_STATUS_TRANSITIONS.draft).not.toContain("completed");
  });
});

describe("RECEIPT_STATUS_TRANSITIONS", () => {
  test("has an entry for every status", () => {
    RECEIPT_STATUSES.forEach((status) => {
      expect(RECEIPT_STATUS_TRANSITIONS[status]).toBeDefined();
    });
  });

  test("received and cancelled are terminal", () => {
    expect(RECEIPT_STATUS_TRANSITIONS.received).toEqual([]);
    expect(RECEIPT_STATUS_TRANSITIONS.cancelled).toEqual([]);
  });
});
