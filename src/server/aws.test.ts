import { expect, test } from "bun:test";
import { isCode, parseExpiry } from "./aws";

test("parseExpiry reads the expiry from the script's last line", () => {
  expect(parseExpiry("'mfa' profile refreshed from 'default'; expires 2026-11-01T05:28:10+00:00\n")).toBe("2026-11-01T05:28:10.000Z");
});

test("parseExpiry gives null when the line has no expiry", () => {
  expect(parseExpiry("something else")).toBeNull();
  expect(parseExpiry("expires not-a-date")).toBeNull();
});

test("isCode accepts exactly 6 digits", () => {
  expect(isCode("123456")).toBe(true);
  expect(isCode("12345")).toBe(false);
  expect(isCode("1234567")).toBe(false);
  expect(isCode("12a456")).toBe(false);
});
