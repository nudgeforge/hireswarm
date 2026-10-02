"use client";

type SwarmEvent = { type: string; agent?: string | null; title: string; message?: string | null; payload: Record<string, unknown>; at?: string | null };
const cx = (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(" ");

export function DeferredActivityStream({ events }: { events: SwarmEvent[] }) {
  return <div className="activity-list">{events.slice(0, 4).map((event, index) => <article key={`${event.type}-${index}-${event.at}`} className={cx("activity-row", event.type)}><span>{String(index + 1).padStart(2, "0")}</span><div><b>{event.title}</b><p>{event.message || event.agent || "System update"}</p></div></article>)}</div>;
}
