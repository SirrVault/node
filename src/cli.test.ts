import { describe, expect, it } from "@jest/globals";
import { parseArgs } from "./cli";

describe("parseArgs", () => {
  it("parses positional args", () => {
    const r = parseArgs(["push", "KEY=val"]);
    expect(r._0).toBe("push");
    expect(r._1).toBe("KEY=val");
    expect(r._count).toBe(2);
  });

  it("parses --flag value pairs", () => {
    const r = parseArgs(["--ttl", "60", "--reads", "1"]);
    expect(r.ttl).toBe("60");
    expect(r.reads).toBe("1");
  });

  it("parses boolean flags", () => {
    const r = parseArgs(["--verbose"]);
    expect(r.verbose).toBe(true);
  });

  it("handles mixed positional and flags", () => {
    const r = parseArgs(["KEY=val", "--ttl", "60", "--verbose"]);
    expect(r._0).toBe("KEY=val");
    expect(r.ttl).toBe("60");
    expect(r.verbose).toBe(true);
    expect(r._count).toBe(1);
  });

  it("returns empty result for empty argv", () => {
    const r = parseArgs([]);
    expect(r._count).toBe(0);
  });

  it("treats --flag followed by --flag as boolean", () => {
    const r = parseArgs(["--verbose", "--debug"]);
    expect(r.verbose).toBe(true);
    expect(r.debug).toBe(true);
  });
});
