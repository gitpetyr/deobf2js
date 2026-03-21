import { describe, it, expect } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

const {
  executeInIsolatedVm,
  IsolatedVmSandbox,
  createIsolatedVmInstance,
  isAvailable,
} = require("../../src/utils/isolatedVmSandbox");

describe("isolatedVmSandbox module exports", () => {
  it("should export executeInIsolatedVm function", () => {
    expect(typeof executeInIsolatedVm).toBe("function");
  });

  it("should export IsolatedVmSandbox class", () => {
    expect(typeof IsolatedVmSandbox).toBe("function");
  });

  it("should export createIsolatedVmInstance function", () => {
    expect(typeof createIsolatedVmInstance).toBe("function");
  });

  it("should export isAvailable boolean", () => {
    expect(typeof isAvailable).toBe("boolean");
  });
});

describe.skipIf(!isAvailable)("executeInIsolatedVm", () => {
  it("should evaluate simple arithmetic", async () => {
    const result = await executeInIsolatedVm("1 + 2");
    expect(result).toBe(3);
  });

  it("should evaluate string expressions", async () => {
    const result = await executeInIsolatedVm("'hello' + ' ' + 'world'");
    expect(result).toBe("hello world");
  });

  it("should respect timeout option", async () => {
    await expect(
      executeInIsolatedVm("while(true){}", { timeout: 100 })
    ).rejects.toThrow();
  });
});

describe.skipIf(!isAvailable)("IsolatedVmSandbox class", () => {
  it("should init, execute, and dispose", async () => {
    const sandbox = new IsolatedVmSandbox();
    await sandbox.init();

    const result = await sandbox.execute("2 * 3");
    expect(result).toBe(6);

    sandbox.dispose();
  });

  it("should auto-init on first execute", async () => {
    const sandbox = new IsolatedVmSandbox();

    const result = await sandbox.execute("10 - 4");
    expect(result).toBe(6);

    sandbox.dispose();
  });

  it("should persist state between executions", async () => {
    const sandbox = new IsolatedVmSandbox();
    await sandbox.init();

    await sandbox.execute("var testVal = 42;");
    const result = await sandbox.execute("testVal");
    expect(result).toBe(42);

    sandbox.dispose();
  });

  it("should provide browser-like globals", async () => {
    const sandbox = new IsolatedVmSandbox();
    await sandbox.init();

    const ua = await sandbox.execute("navigator.userAgent");
    expect(ua).toContain("Chrome");

    const vis = await sandbox.execute("document.visibilityState");
    expect(vis).toBe("visible");

    sandbox.dispose();
  });

  it("eval should behave like execute", async () => {
    const sandbox = new IsolatedVmSandbox();
    await sandbox.init();

    const result = await sandbox.eval("5 + 5");
    expect(result).toBe(10);

    sandbox.dispose();
  });
});

describe.skipIf(!isAvailable)("createIsolatedVmInstance", () => {
  it("should return an object with the unified sandbox interface", async () => {
    const instance = await createIsolatedVmInstance();

    expect(instance.type).toBe("isolated-vm");
    expect(typeof instance.execute).toBe("function");
    expect(typeof instance.call).toBe("function");
    expect(typeof instance.close).toBe("function");

    await instance.close();
  });

  it("should execute code and call functions", async () => {
    const instance = await createIsolatedVmInstance();

    await instance.execute("function add(a, b) { return a + b; }");
    const result = await instance.call("add", [3, 4]);
    expect(result).toBe(7);

    await instance.close();
  });
});

describe.skipIf(isAvailable)(
  "when isolated-vm is not installed",
  () => {
    it("executeInIsolatedVm should throw helpful error", async () => {
      await expect(executeInIsolatedVm("1+1")).rejects.toThrow(
        /isolated-vm is not installed/
      );
    });

    it("IsolatedVmSandbox constructor should throw helpful error", () => {
      expect(() => new IsolatedVmSandbox()).toThrow(
        /isolated-vm is not installed/
      );
    });
  }
);
