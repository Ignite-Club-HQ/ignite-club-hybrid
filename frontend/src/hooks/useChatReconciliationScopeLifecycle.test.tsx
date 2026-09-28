import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useChatReconciliationScopeLifecycle } from "./useChatReconciliationScopeLifecycle";

const clearReconciliationScope = vi.fn();

vi.mock("@/lib/chatMessageReconciliation", () => ({
  clearReconciliationScope: (scopeKey: string) => clearReconciliationScope(scopeKey),
}));

describe("useChatReconciliationScopeLifecycle", () => {
  beforeEach(() => clearReconciliationScope.mockClear());

  it("retains reconciliation across ordinary rerenders and clears only on scope change or unmount", () => {
    const { rerender, unmount } = renderHook(
      ({ scopeKey, queryVersion }) => {
        void queryVersion;
        useChatReconciliationScopeLifecycle(scopeKey);
      },
      { initialProps: { scopeKey: "dm:one", queryVersion: 1 } },
    );

    rerender({ scopeKey: "dm:one", queryVersion: 2 });
    expect(clearReconciliationScope).not.toHaveBeenCalled();

    rerender({ scopeKey: "dm:two", queryVersion: 3 });
    expect(clearReconciliationScope).toHaveBeenCalledTimes(1);
    expect(clearReconciliationScope).toHaveBeenLastCalledWith("dm:one");

    unmount();
    expect(clearReconciliationScope).toHaveBeenCalledTimes(2);
    expect(clearReconciliationScope).toHaveBeenLastCalledWith("dm:two");
  });
});
