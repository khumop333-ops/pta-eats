/**
 * ============================================================================
 * ROMA BANK TRANSFER DETAILS — THIS IS THE ONLY FILE YOU NEED TO EDIT
 * ============================================================================
 *
 * Fill in Roma's real business account below. The checkout page reads these
 * values and shows them to the customer with a copy button next to each one.
 *
 * While any of these are blank, checkout shows a friendly
 * "bank details coming soon" message instead, and the customer is invited to
 * pay cash on delivery or ask Roma for the account number on WhatsApp. Nothing
 * breaks — so it is safe to ship this file empty and fill it in later.
 *
 * Never put made-up account numbers here: customers pay real money into
 * whatever is written in this file.
 *
 * How to fill it in (example shape only — these are NOT real details):
 *
 *   bankName: "Example Bank",
 *   accountHolder: "Roma Trading (Pty) Ltd",
 *   accountNumber: "1234567890",
 *   branchCode: "123456",
 *
 * After editing, commit the change and let the site deploy as usual.
 */
export type BankTransferDetails = {
  bankName: string;
  accountHolder: string;
  accountNumber: string;
  branchCode: string;
};

export const BANK_TRANSFER_DETAILS: BankTransferDetails = {
  bankName: "",
  accountHolder: "",
  accountNumber: "",
  branchCode: "",
};

/**
 * True only when every field the customer needs in order to pay is filled in.
 * A half-filled set of details is treated as "not ready" on purpose — showing
 * an account number without a branch code would just cause failed payments.
 */
export const hasBankTransferDetails = (
  details: BankTransferDetails = BANK_TRANSFER_DETAILS,
): boolean =>
  [details.bankName, details.accountHolder, details.accountNumber, details.branchCode].every(
    (value) => value.trim().length > 0,
  );
