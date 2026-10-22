"use client";
import { useEffect, useRef, useState } from "react";
import {
  ApiError,
  createStaffWebApi,
  type StaffInboxPage,
} from "@pulse/api-client";
const api = createStaffWebApi();

export function NotificationCentre({
  full = false,
  facilityId,
}: {
  full?: boolean;
  facilityId: string;
}) {
  const [open, setOpen] = useState(full);
  const [unread, setUnread] = useState(false);
  const [page, setPage] = useState<StaffInboxPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const bell = useRef<HTMLButtonElement>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    let disposed = false;
    async function load() {
      if (document.hidden) return;
      controller.current?.abort();
      const current = new AbortController();
      controller.current = current;
      try {
        const result = await api.notifications({
          unread,
          signal: current.signal,
        });
        if (!disposed && !current.signal.aborted) {
          setPage(result);
          setError(null);
        }
      } catch (err) {
        if (disposed || current.signal.aborted) return;
        setPage(null);
        if (err instanceof ApiError && err.status === 401)
          window.location.assign("/login");
        else
          setError(
            err instanceof ApiError
              ? err.message
              : "Could not load notifications. Please retry.",
          );
      }
    }
    setPage(null);
    void load();
    const interval = setInterval(() => {
      void load();
    }, 30_000);
    const update = () => {
      void load();
    };
    document.addEventListener("visibilitychange", update);
    window.addEventListener("focus", update);
    window.addEventListener("pulse:inbox-refresh", update);
    return () => {
      disposed = true;
      controller.current?.abort();
      clearInterval(interval);
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("focus", update);
      window.removeEventListener("pulse:inbox-refresh", update);
    };
  }, [facilityId, unread, refresh]);
  useEffect(() => {
    if (!open || full) return;
    function outside(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open, full]);
  async function read(id: string) {
    if (reading) return;
    setReading(id);
    try {
      await api.readNotification(id);
      window.dispatchEvent(new Event("pulse:inbox-refresh"));
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Could not mark this notification as read.",
      );
    } finally {
      setReading(null);
    }
  }
  async function more() {
    if (!page?.nextCursor || busy) return;
    setBusy(true);
    const current = new AbortController();
    controller.current?.abort();
    controller.current = current;
    try {
      const next = await api.notifications({
        unread,
        cursor: page.nextCursor,
        signal: current.signal,
      });
      if (!current.signal.aborted)
        setPage((previous) =>
          previous
            ? {
                ...next,
                items: [
                  ...previous.items,
                  ...next.items.filter(
                    (item) => !previous.items.some((old) => old.id === item.id),
                  ),
                ],
              }
            : next,
        );
    } catch (err) {
      if (!current.signal.aborted)
        setError(
          err instanceof ApiError
            ? err.message
            : "Could not load the next page.",
        );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      ref={root}
      className={
        full
          ? "notification-centre notification-centre--full"
          : "notification-centre"
      }
      onKeyDown={(event) => {
        if (event.key === "Escape" && !full) {
          setOpen(false);
          bell.current?.focus();
        }
      }}
      onBlur={(event) => {
        if (
          !full &&
          !event.currentTarget.contains(event.relatedTarget as Node | null)
        )
          setOpen(false);
      }}
    >
      {!full ? (
        <button
          ref={bell}
          type="button"
          className="notification-bell"
          aria-label={
            error
              ? "Notifications unavailable"
              : `Notifications${page ? `, ${page.unreadCount} unread` : ", loading"}`
          }
          aria-expanded={open}
          aria-controls="notification-preview"
          onClick={() => setOpen((value) => !value)}
        >
          <svg
            width="21"
            height="21"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {error ? (
            <span className="notification-bell__count">!</span>
          ) : page && page.unreadCount > 0 ? (
            <span className="notification-bell__count">
              {page.unreadCount > 99 ? "99+" : page.unreadCount}
            </span>
          ) : null}
        </button>
      ) : null}
      {open ? (
        <section
          id={full ? "notification-inbox" : "notification-preview"}
          className="notification-panel"
          aria-label={full ? "Notification inbox" : "Recent notifications"}
        >
          <div className="notification-panel__heading">
            <h2>{full ? "Your inbox" : "Notifications"}</h2>
            <span>{page ? `${page.unreadCount} unread` : ""}</span>
          </div>
          {full ? (
            <div className="notification-filters">
              <button
                type="button"
                aria-pressed={!unread}
                onClick={() => setUnread(false)}
              >
                All
              </button>
              <button
                type="button"
                aria-pressed={unread}
                onClick={() => setUnread(true)}
              >
                Unread
              </button>
            </div>
          ) : null}
          {error ? (
            <div role="alert" className="notification-message">
              <p>{error}</p>
              <button
                type="button"
                onClick={() => setRefresh((value) => value + 1)}
              >
                Retry
              </button>
            </div>
          ) : null}
          {!page && !error ? (
            <p className="notification-message" role="status">
              Loading notifications...
            </p>
          ) : null}
          {page && !page.items.length && !error ? (
            <div className="notification-message">
              <strong>
                {unread ? "You’re all caught up" : "No notifications yet"}
              </strong>
              <p>Assigned work will appear here.</p>
            </div>
          ) : null}
          {page?.items.length ? (
            <ul className="notification-list">
              {(full ? page.items : page.items.slice(0, 5)).map((item) => (
                <li
                  key={item.id}
                  className={
                    !item.readAt
                      ? "notification-item notification-item--unread"
                      : "notification-item"
                  }
                >
                  <span className="notification-item__dot" aria-hidden="true" />
                  <div>
                    <a href={`/tasks/${item.taskId}`}>{item.title}</a>
                    <p>
                      Task ·{" "}
                      <time dateTime={item.createdAt}>
                        {new Date(item.createdAt).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </time>
                    </p>
                    {!item.readAt ? (
                      <button
                        type="button"
                        disabled={reading !== null}
                        onClick={() => {
                          void read(item.id);
                        }}
                      >
                        {reading === item.id ? "Updating..." : "Mark as read"}
                      </button>
                    ) : (
                      <span className="notification-item__read">Read</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
          {full && page?.nextCursor ? (
            <button
              type="button"
              className="notification-more"
              disabled={busy}
              onClick={() => {
                void more();
              }}
            >
              {busy ? "Loading..." : "Load more"}
            </button>
          ) : null}
          {!full ? (
            <a className="notification-panel__all" href="/notifications">
              View all notifications
            </a>
          ) : (
            <p className="notification-note">
              Reading a notification does not complete the assigned task.
            </p>
          )}
        </section>
      ) : null}
    </div>
  );
}
