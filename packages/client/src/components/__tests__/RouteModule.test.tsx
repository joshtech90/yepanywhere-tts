import { act, cleanup, render } from "@testing-library/react";
import { lazy, useEffect } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acquireClientQueryBootstrapSlot,
  resetClientQueryBootstrapForTests,
} from "../../lib/clientQueryBootstrap";
import {
  LOCAL_CLIENT_SUMMARY_SOURCE_KEY,
  setCurrentClientSummarySourceKey,
} from "../../lib/clientSummaryStore";
import { RouteModule } from "../RouteModule";

vi.mock("../../i18n", () => ({ useI18n: () => ({ t: () => "Loading" }) }));

afterEach(() => {
  cleanup();
  resetClientQueryBootstrapForTests();
  vi.useRealTimers();
});

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function fixture(delayedLayout = false) {
  setCurrentClientSummarySourceKey(LOCAL_CLIENT_SUMMARY_SOURCE_KEY);
  let resolve!: (value: { default: typeof Page }) => void;
  let finishRoute!: () => void;
  let supplementaryStarted = false;
  const Page = () => {
    useEffect(() => {
      const slot = acquireClientQueryBootstrapSlot(
        LOCAL_CLIENT_SUMMARY_SOURCE_KEY,
        "route",
      );
      finishRoute = slot.settle;
      return slot.settle;
    }, []);
    return <div>Page ready</div>;
  };
  const LazyPage = lazy(
    () =>
      new Promise<{ default: typeof Page }>((done) => {
        resolve = done;
      }),
  );
  const Shell = () => {
    useEffect(() => {
      const slot = acquireClientQueryBootstrapSlot(
        LOCAL_CLIENT_SUMMARY_SOURCE_KEY,
        "supplementary",
      );
      void slot.ready().then(() => {
        supplementaryStarted = true;
        slot.settle();
      });
      return slot.settle;
    }, []);
    return null;
  };
  let resolveLayout!: (value: { default: typeof Layout }) => void;
  const Layout = () => (
    <>
      <RouteModule>
        <LazyPage />
      </RouteModule>
    </>
  );
  const LazyLayout = lazy(
    () =>
      new Promise<{ default: typeof Layout }>((done) => {
        resolveLayout = done;
      }),
  );
  const view = render(
    <MemoryRouter>
      <Shell />
      {delayedLayout ? (
        <RouteModule>
          <LazyLayout />
        </RouteModule>
      ) : (
        <Layout />
      )}
    </MemoryRouter>,
  );
  return {
    view,
    started: () => supplementaryStarted,
    load: () => act(async () => resolve({ default: Page })),
    loadLayout: () => act(async () => resolveLayout({ default: Layout })),
    finish: () => act(() => finishRoute()),
  };
}

describe("RouteModule startup admission", () => {
  it("preserves route priority when the page mounts after fast shell work", async () => {
    const run = fixture();
    await flush();
    expect(run.started()).toBe(false);
    await run.load();
    await flush();
    expect(run.started()).toBe(false);
    run.finish();
    await flush();
    expect(run.started()).toBe(true);
  });

  it("hands the initial hold through a lazy shell/layout to the selected page", async () => {
    const run = fixture(true);
    await flush();
    expect(run.started()).toBe(false);
    await run.loadLayout();
    await flush();
    expect(run.started()).toBe(false);
    await run.load();
    await flush();
    expect(run.started()).toBe(false);
    run.finish();
    await flush();
    expect(run.started()).toBe(true);
  });

  it("keeps the existing deadline when the lazy module never loads", async () => {
    vi.useFakeTimers();
    const run = fixture();
    await flush();
    await act(() => vi.advanceTimersByTimeAsync(1_999));
    expect(run.started()).toBe(false);
    await act(() => vi.advanceTimersByTimeAsync(2_001));
    expect(run.started()).toBe(true);
  });

  it("releases a suspended module's hold when its owner unmounts", async () => {
    const run = fixture();
    await flush();
    expect(run.started()).toBe(false);
    run.view.unmount();
    await flush();
    expect(run.started()).toBe(true);
  });
});
