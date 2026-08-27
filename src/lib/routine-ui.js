export const EVENT_TRIGGERS = [
  { kind: "slack", label: "Slack message" },
  { kind: "git", label: "Git event" },
  { kind: "teams", label: "Teams message" },
  { kind: "linear", label: "Linear issue" },
  { kind: "sentry", label: "Sentry alert" },
  { kind: "pagerduty", label: "PagerDuty incident" },
  { kind: "webhook", label: "Webhook" },
];

export const CADENCES = [
  { id: "once", label: "Once" },
  { id: "hourly", label: "Every hour" },
  { id: "daily", label: "Every day" },
  { id: "weekdays", label: "Weekdays" },
  { id: "weekly", label: "Every week" },
  { id: "monthly", label: "Every month" },
  { id: "interval", label: "Every 30 minutes" },
];

export function newTrigger(kind, cadence = "once") {
  return {
    id: `tr-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    cadence: kind === "schedule" ? cadence : "",
    at: null,
    intervalMin: 30,
    cron: "",
  };
}

export function labelTrigger(tr) {
  if (!tr) return "Not scheduled";
  if (tr.kind !== "schedule") {
    return (EVENT_TRIGGERS.find((t) => t.kind === tr.kind) || {}).label || tr.kind;
  }
  if (tr.cadence === "once" && tr.at) {
    const d = new Date(tr.at);
    if (!Number.isNaN(d.getTime())) {
      const day = d.toLocaleDateString([], { month: "short", day: "numeric" });
      const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      return `Once · ${day} ${time}`;
    }
    return "Once";
  }
  return (CADENCES.find((c) => c.id === tr.cadence) || {}).label || "On a schedule";
}

export function labelRoutine(item) {
  const triggers = item?.triggers || [];
  if (!triggers.length && item?.at) return labelTrigger({ kind: "schedule", cadence: "once", at: item.at });
  if (!triggers.length) return "No trigger";
  return triggers.map(labelTrigger).join(" · ");
}
